/**
 * AI 검토 파이프라인 통합 테스트 (LLM·DB 모의) — 실행: npm run test:unit
 *  검토 → (수정 → 재검토) → 자동 발행 / 초안 유지, 자동 발행 스위치, dry-run(저장·발행 없음), 재생성 필요 판.
 *  2026-11-03: 자동 발행은 독립 검토 2회(BRIEFING_REVIEW_PASSES 기본 2) 모두 통과해야 한다.
 *  발행은 검토한 정확한 행(id·version)으로만 부른다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { runReviewPipeline, type PipelineDeps } from "../../src/lib/briefing/review/pipeline";
import { policyFromEnv } from "../../src/lib/briefing/review/policy";
import type { ReviewInput } from "../../src/lib/briefing/review/evidence";
import type { BriefingRow } from "../../src/lib/briefing/repository";
import { A1, A2, dailyRow, fakeInput, reviewerJson } from "./review-fixtures";

interface Harness {
  regens: { date: string; must: string[]; reason: string }[];
  retrans: { locales: string[]; notes: string[]; preferFallback: boolean }[];
  deps: PipelineDeps;
  published: { id: string; version: number }[];
  saved: Record<string, unknown>[];
  decisions: { reviewId: string; decision: Record<string, unknown> }[];
  stored: { trigger: string; round: number; verdict: string | null }[];
  chats: number;
}

function harness(replies: ((input: ReviewInput) => unknown)[], inputs: Map<string, ReviewInput>): Harness {
  const h: Harness = { regens: [], retrans: [], deps: null as unknown as PipelineDeps, published: [], saved: [], decisions: [], stored: [], chats: 0 };
  let current: ReviewInput | null = null;
  let n = 0;
  h.deps = {
    review: {
      chat: async (_req, onUsage) => {
        const reply = replies[h.chats++];
        assert.ok(reply, "예상보다 검토 호출이 많음");
        onUsage?.({ requestId: `req-${h.chats}`, model: "mock", inputTokens: 1000, outputTokens: 200, costUsd: 0.01, latencyMs: 5, finishReason: "stop" });
        return { content: JSON.stringify(reply(current!)), usage: { requestId: null, model: "mock", inputTokens: 0, outputTokens: 0, costUsd: 0, latencyMs: 0, finishReason: "stop" } };
      },
      loadInput: async () => {
        throw new Error("파이프라인은 입력을 직접 넘긴다");
      },
      store: async (r) => {
        h.stored.push({ trigger: r.trigger, round: r.round, verdict: r.verdict });
        return `rev-${++n}`;
      },
    },
    loadInput: async (id) => {
      const i = inputs.get(id);
      assert.ok(i, `입력 없음 ${id}`);
      current = i;
      return i;
    },
    findTargets: async () => [],
    lock: (_t, fn) => fn(),
    producedByRound: async (id) => (id === "fixed-1" ? 0 : null),
    pipelineReviews: async () => [],
    publishable: async () => ({ ok: true, detail: "최신" }),
    publish: async (_t, row: BriefingRow) => {
      h.published.push({ id: row.id, version: row.version });
      return { published: [{ locale: "ko", id: row.id, version: row.version }] };
    },
    saveFixed: async (input, content) => {
      h.saved.push(content);
      const row = dailyRow({ id: "fixed-1", version: input.row.version + 1, content: content as BriefingRow["content"] });
      inputs.set("fixed-1", fakeInput(row));
      return { id: "fixed-1", version: row.version };
    },
    saveTranslations: async () => {},
    retranslate: async (_ko, _input, locales = ["en", "zh"], optsFor) => {
      h.retrans.push({ locales: [...locales], notes: locales.flatMap((l) => optsFor?.(l).reviewNotes ?? []), preferFallback: locales.every((l) => optsFor?.(l).preferFallback === true) });
      return locales.map((l) => ({ locale: l, content: { headline: "x" }, candidate: null, problems: [], repaired: false, usages: [] }));
    },
    regenerate: async (t, must, reason) => {
      h.regens.push({ date: t.date, must, reason });
      const row = dailyRow({ id: "regen-1", version: 9, validation: { final: { fatal: [], warn: [] }, regen_reason: reason } as BriefingRow["validation"] });
      inputs.set("regen-1", fakeInput(row));
      return { koId: "regen-1", outcome: "generated", message: "" };
    },
    recordDecision: async (reviewId, decision) => {
      h.decisions.push({ reviewId, decision: decision as Record<string, unknown> });
    },
    now: () => 0,
  };
  // 입력 첫 읽기 전에도 current 가 있게
  current = inputs.values().next().value ?? null;
  return h;
}

const ORIG = dailyRow();
const pass = (i: ReviewInput) => reviewerJson(i);
/** 헤드라인 overclaim 2건(헤드라인·주요 기사 제목) → 근거로 고친 헤드라인, 주목 기업 문장은 근거 없음(수정안 없음 → 삭제) */
const fixable = (i: ReviewInput) =>
  reviewerJson(
    i,
    {
      S01: { l: "overclaim", e: "智谱发布GLM-6", n: "'중국 최대' 근거 없음" },
      S14: { l: "unsupported", e: "근거 없음", n: "기사에 없음" },
    },
    { fixes: [{ s: "S01", a: "replace", t: "즈푸, GLM-6 공개", e: "智谱发布GLM-6" }], verdict: "FIXABLE" }
  );
const policy = policyFromEnv({ BRIEFING_AUTO_PUBLISH: "on" });

test("PASS ×2 → 검토한 정확한 행(id·version)으로 자동 발행, 결정 기록 (1차 confirm_pending → 확인 검토 → published)", async () => {
  const h = harness([pass, pass], new Map([[ORIG.id, fakeInput(ORIG)]]));
  const r = await runReviewPipeline({ briefingId: ORIG.id, policy }, h.deps);
  assert.deepEqual(h.published, [{ id: ORIG.id, version: 3 }]);
  assert.equal(r.processed[0].published, true);
  assert.equal(r.notify, true);
  assert.match(r.message, /2회 통과.*자동 발행/);
  assert.deepEqual(h.decisions.map((d) => d.decision.action), ["confirm_pending", "published"]);
  assert.equal(h.decisions[0].decision.final, false);
  assert.equal(h.saved.length, 0);
});

test("1차 PASS → 확인 검토 FIXABLE → 발행하지 않고 그 검토로 수정 → 새 버전은 다시 2회 통과해야 발행", async () => {
  const h = harness([pass, fixable, pass, pass], new Map([[ORIG.id, fakeInput(ORIG)]]));
  await runReviewPipeline({ briefingId: ORIG.id, policy }, h.deps);
  assert.equal(h.saved.length, 1);
  assert.deepEqual(h.published, [{ id: "fixed-1", version: 4 }]);
  assert.deepEqual(h.decisions.map((d) => d.decision.action), ["confirm_pending", "fixed", "confirm_pending", "published"]);
});

test("재개: 1차 통과(confirm_pending) 기록이 있으면 확인 검토만 하고 발행", async () => {
  const h = harness([pass], new Map([[ORIG.id, fakeInput(ORIG)]]));
  const first = { id: "rev-old", status: "done", final: false, action: "confirm_pending", result: { id: "rev-old", score: 9.5 } as never };
  h.deps.pipelineReviews = async () => [first];
  const r = await runReviewPipeline({ briefingId: ORIG.id, policy }, h.deps);
  assert.equal(h.chats, 1);
  assert.deepEqual(h.published, [{ id: ORIG.id, version: 3 }]);
  assert.match(r.message, /2회 통과\(9\.5·/);
});

test("BRIEFING_REVIEW_PASSES=1 → 예전처럼 검토 1회 통과로 발행", async () => {
  const h = harness([pass], new Map([[ORIG.id, fakeInput(ORIG)]]));
  await runReviewPipeline({ briefingId: ORIG.id, policy: policyFromEnv({ BRIEFING_AUTO_PUBLISH: "on", BRIEFING_REVIEW_PASSES: "1" }) }, h.deps);
  assert.deepEqual(h.published, [{ id: ORIG.id, version: 3 }]);
  assert.equal(h.chats, 1);
});

test("FIXABLE → 근거로 고친 새 버전 저장 → 재검토 PASS → 새 버전을 발행", async () => {
  const h = harness([fixable, pass, pass], new Map([[ORIG.id, fakeInput(ORIG)]]));
  const r = await runReviewPipeline({ briefingId: ORIG.id, policy }, h.deps);
  assert.equal(h.saved.length, 1);
  const fixed = h.saved[0] as { headline: string; companies_to_watch: unknown[] };
  assert.equal(fixed.headline, "즈푸, GLM-6 공개");
  assert.equal(fixed.companies_to_watch.length, 0, "근거 없는 문장은 지워 항목이 빠진다");
  assert.deepEqual(h.published, [{ id: "fixed-1", version: 4 }]);
  assert.deepEqual(h.stored.map((s) => s.round), [0, 1, 1]);
  assert.deepEqual(h.decisions.map((d) => d.decision.action), ["fixed", "confirm_pending", "published"]);
  assert.equal(r.processed[0].steps.map((s) => s.action).join(","), "reviewed,fixed,reviewed,reviewed,reviewed,published");
});

test("자동 발행 스위치 off → 통과해도 발행하지 않고 알림", async () => {
  const h = harness([pass, pass], new Map([[ORIG.id, fakeInput(ORIG)]]));
  const r = await runReviewPipeline({ briefingId: ORIG.id, policy: policyFromEnv({ BRIEFING_AUTO_PUBLISH: "off" }) }, h.deps);
  assert.equal(h.published.length, 0);
  assert.equal(h.decisions.at(-1)!.decision.action, "switch_off");
  assert.match(r.message, /자동 발행이 꺼져/);
});

test("dry-run → 수정본을 메모리에서만 만들고 저장·발행하지 않는다", async () => {
  const h = harness([fixable, pass, pass], new Map([[ORIG.id, fakeInput(ORIG)]]));
  const r = await runReviewPipeline({ briefingId: ORIG.id, dryRun: true, policy }, h.deps);
  assert.equal(h.saved.length, 0);
  assert.equal(h.published.length, 0);
  assert.deepEqual(h.stored.map((s) => s.trigger), ["dry_run", "dry_run", "dry_run"]);
  assert.deepEqual(h.decisions.map((d) => d.decision.action), ["fixed_in_memory", "confirm_pending", "would_publish"]);
  assert.match(r.message, /dry-run/);
});

test("재생성 필요(wrong 3건) → 고치지 않고 초안 유지 + 알림", async () => {
  const bad = (i: ReviewInput) =>
    reviewerJson(i, { S02: { l: "wrong", e: "x", n: "x" }, S06: { l: "wrong", e: "x", n: "x" }, S10: { l: "wrong", e: "x", n: "x" } }, { verdict: "FAIL" });
  const h = harness([bad], new Map([[ORIG.id, fakeInput(ORIG)]]));
  const r = await runReviewPipeline({ briefingId: ORIG.id, policy }, h.deps);
  assert.equal(h.saved.length, 0);
  assert.equal(h.published.length, 0);
  assert.equal(h.decisions.at(-1)!.decision.action, "hold");
  assert.equal(r.notify, true);
  assert.match(r.message, /초안 유지/);
});

test("수정 2회 뒤에도 미달 → 초안 유지 (검토 최대 3회)", async () => {
  const inputs = new Map([[ORIG.id, fakeInput(ORIG)]]);
  const h = harness([fixable, fixable, fixable], inputs);
  // 두 번째 수정본도 같은 id 로 저장되도록: producedByRound 를 회차대로
  let round = -1;
  h.deps.producedByRound = async () => (round++ < 0 ? null : round - 1);
  const r = await runReviewPipeline({ briefingId: ORIG.id, policy }, h.deps);
  assert.equal(h.chats, 3);
  assert.equal(h.published.length, 0);
  assert.match(r.processed[0].steps.at(-1)!.detail, /수정 2회 뒤에도 미달|고칠|적용할 수정이 없음/);
});

test("제목만 판(mode headlines) → AI 검토 없이 결정적 조건으로 자동 발행 + 대체 판 알림", async () => {
  const content = {
    headline: "10월 28일 중국 AI 주요 기사",
    lede: "오늘은 자동 검증을 통과한 요약을 만들지 못해 주요 기사 제목과 원문 링크만 싣습니다.",
    lede_refs: [],
    top_stories: [1, 2, 3].map((i) => ({ rank: i, section: "industry", subject: "", subject_is_chinese: true, title: `기사 ${i}`, what: "보도: 36Kr", why: "", refs: [], primary_ref: "" })),
    sections: [], key_numbers: [], companies_to_watch: [], term_of_the_day: null, clusters: [], excluded: [],
  };
  const row = dailyRow({ id: "hl-1", mode: "headlines", content, validation: { fallback: "headlines", fallback_reason: "3회 실패", final: { fatal: [], warn: [] } } });
  const inp = fakeInput(row, { genLog: { fallback: "headlines", fallbackReason: "3회 실패", targetedRepair: false, edits: [], warns: [] } });
  const h = harness([], new Map([[row.id, inp]]));
  const r = await runReviewPipeline({ briefingId: row.id, policy }, h.deps);
  assert.equal(h.chats, 0, "LLM 을 부르지 않는다");
  assert.deepEqual(h.published, [{ id: "hl-1", version: 3 }]);
  assert.match(r.message, /대체 판 제목만: 3회 실패/);
  assert.equal(r.notify, true);
  const off = harness([], new Map([[row.id, inp]]));
  await runReviewPipeline({ briefingId: row.id, policy: policyFromEnv({ BRIEFING_AUTO_PUBLISH: "on", BRIEFING_AUTO_PUBLISH_HEADLINES: "off" }) }, off.deps);
  // AI 검토 스위치가 꺼져 있어도(기본) 제목만 판은 발행한다 — LLM 문장이 없다
  const def = harness([], new Map([[row.id, inp]]));
  await runReviewPipeline({ briefingId: row.id, policy: policyFromEnv({}) }, def.deps);
  assert.deepEqual(def.published, [{ id: "hl-1", version: 3 }]);
  assert.equal(off.published.length, 0);
  assert.equal(off.decisions.at(-1)!.decision.action, "hold");
});

test("검토 응답이 스키마 오류면 결정 없이 다음 호출로 (발행 없음)", async () => {
  const h = harness([() => ({ verdict: "PASS" })], new Map([[ORIG.id, fakeInput(ORIG)]]));
  const r = await runReviewPipeline({ briefingId: ORIG.id, policy }, h.deps);
  assert.equal(h.published.length, 0);
  assert.equal(r.processed[0].final, false);
  assert.equal(r.pending, 1);
});

// 2026-11-03: 번역만 문제인 판 → 검토 지적을 넘겨 재시도 모델로 다시 번역 → 처음부터 2회 검토
test("번역만 문제(번역 major, 문장 오류 0) → 지적 사항으로 재번역(Sonnet 우선) → 2회 통과 후 발행, ko 새 버전 없음", async () => {
  const trBad = (i: ReviewInput) =>
    reviewerJson(i, {}, { translation: [{ loc: "en", s: "S01", sev: "major", issue: "added a date not in Korean" }], verdict: "FIXABLE" });
  const h = harness([trBad, pass, pass], new Map([[ORIG.id, fakeInput(ORIG)]]));
  const r = await runReviewPipeline({ briefingId: ORIG.id, policy }, h.deps);
  assert.equal(h.saved.length, 0, "ko 는 그대로");
  assert.deepEqual(h.retrans.map((x) => x.locales), [["en"]]);
  assert.equal(h.retrans[0].preferFallback, true);
  assert.match(h.retrans[0].notes[0], /added a date/);
  assert.deepEqual(h.decisions.map((d) => d.decision.action), ["retranslated", "confirm_pending", "published"]);
  assert.equal(h.decisions[0].decision.final, false);
  assert.deepEqual(h.published, [{ id: ORIG.id, version: 3 }]);
  assert.equal(r.processed[0].published, true);
});

test("번역 재시도는 판당 1회 — 다시 번역해도 번역 major 가 남으면 초안 유지", async () => {
  const trBad = (i: ReviewInput) =>
    reviewerJson(i, {}, { translation: [{ loc: "zh", s: "S01", sev: "major", issue: "wrong name" }], verdict: "FIXABLE" });
  const h = harness([trBad, trBad], new Map([[ORIG.id, fakeInput(ORIG)]]));
  await runReviewPipeline({ briefingId: ORIG.id, policy }, h.deps);
  assert.equal(h.retrans.length, 1);
  assert.equal(h.published.length, 0);
  assert.deepEqual(h.decisions.map((d) => d.decision.action), ["retranslated", "hold"]);
});

// 2026-11-03: 누락만 문제인 판 → 반드시 넣을 기사로 다시 생성 → 새 판을 2회 검토
test("누락만 문제(중요 누락, 문장 오류 0, 점수 미달) → 판 잠금 밖에서 다시 생성 → 새 판 2회 통과 후 발행", async () => {
  const omit = (i: ReviewInput) => reviewerJson(i, {}, { omissions: [{ c: "C1", important: true, why: "여러 매체가 다룬 큰 이야기" }], verdict: "FIXABLE" });
  let locked = 0;
  const h = harness([omit, pass, pass], new Map([[ORIG.id, fakeInput(ORIG)]]));
  const lock = h.deps.lock;
  h.deps.lock = async (t, fn) => {
    locked++;
    try { return await lock(t, fn); } finally { locked--; }
  };
  const regen = h.deps.regenerate;
  h.deps.regenerate = async (t, m, r) => {
    assert.equal(locked, 0, "재생성은 판 잠금 밖에서");
    return regen(t, m, r);
  };
  const r = await runReviewPipeline({ briefingId: ORIG.id, policy, budgetMs: 10_000_000 }, h.deps);
  assert.deepEqual(h.regens.map((x) => x.must), [["33333333-3333-4333-8333-333333333333"]]);
  assert.match(h.regens[0].reason, /바이두 새 칩/);
  assert.deepEqual(h.decisions.map((d) => d.decision.action), ["regenerate_omission", "confirm_pending", "published"]);
  assert.deepEqual(h.published, [{ id: "regen-1", version: 9 }]);
  assert.match(r.message, /다시 생성/);
});

test("이미 누락 재생성한 판(validation.regen_reason)은 또 재생성하지 않고 초안 유지", async () => {
  const omit = (i: ReviewInput) => reviewerJson(i, {}, { omissions: [{ c: "C1", important: true, why: "큰 이야기" }], verdict: "FIXABLE" });
  const row = dailyRow({ validation: { final: { fatal: [], warn: [] }, regen_reason: "이전 재생성" } as BriefingRow["validation"] });
  const h = harness([omit], new Map([[row.id, fakeInput(row)]]));
  await runReviewPipeline({ briefingId: row.id, policy }, h.deps);
  assert.equal(h.regens.length, 0);
  assert.equal(h.decisions.at(-1)!.decision.action, "hold");
});

test("쉬운 AI 설명: 데일리 자동 발행 뒤 같은 함수를 부르고 알림에 한 줄, dry-run 은 부르지 않음", async () => {
  const h = harness([pass, pass], new Map([[ORIG.id, fakeInput(ORIG)]]));
  let calls = 0;
  h.deps.easyTerms = async () => (calls++, "쉬운 AI 설명 3건");
  const r = await runReviewPipeline({ briefingId: ORIG.id, policy }, h.deps);
  assert.equal(calls, 1);
  assert.match(r.message, /자동 발행.*· 쉬운 AI 설명 3건/);

  const d = harness([pass, pass], new Map([[ORIG.id, fakeInput(ORIG)]]));
  let dryCalls = 0;
  d.deps.easyTerms = async () => (dryCalls++, "x");
  await runReviewPipeline({ briefingId: ORIG.id, dryRun: true, policy }, d.deps);
  assert.equal(dryCalls, 0);
});

test("쉬운 AI 설명: 정기 스윕은 끝에 따라잡기를 한 번 부르고, 실패해도 검토 결과는 그대로", async () => {
  const h = harness([], new Map([[ORIG.id, fakeInput(ORIG)]]));
  h.deps.easyTerms = async () => {
    throw new Error("timeout");
  };
  const r = await runReviewPipeline({ policy }, h.deps);
  assert.equal(r.processed.length, 0);
  assert.match(r.message, /쉬운 AI 설명 실패: timeout/);
});

// ───────── 주간·월간 마지막 차례 지우기 (2026-11-10 사용자 결정 "주간 리포트 매주 자동 발행")
const WEEKLY_CONTENT = {
  headline: "즈푸 GLM-6 공개, 문샷AI 투자 유치",
  dek: "즈푸가 GLM-6를 공개했고 문샷AI는 10억 달러를 유치했다.",
  dek_refs: [A1, A2],
  big_picture: [
    { title: "오픈소스 모델", text: "즈푸가 GLM-6를 공개했다. 매개변수는 1조 2천억 개다.", refs: [A1], metrics: [] },
    { title: "투자", text: "문샷AI가 10억 달러 규모 투자를 유치했다.", refs: [A2], metrics: [] },
    { title: "경쟁", text: "GLM-6는 오픈소스로 배포된다.", refs: [A1], metrics: [] },
  ],
  movers: [],
  watch_next: [],
  meta: { edition_type: "weekly", period_key: "2026-W44", period_start: "2026-10-26", period_end: "2026-11-01", locale: "ko", ai_generated: true },
};
const weeklyRow = (over: Partial<BriefingRow> = {}) =>
  dailyRow({ id: "wwwwwwww-wwww-4www-8www-wwwwwwwwwwww", edition_type: "weekly", edition_date: "2026-10-26", period_start: "2026-10-26", period_end: "2026-11-01", content: structuredClone(WEEKLY_CONTENT) as unknown as BriefingRow["content"], ...over });
const weeklyInput = (row: BriefingRow) => fakeInput(row, { translations: [] });
/** 큰 흐름 3번째 본문만 unsupported (수정안 없음) */
const weeklyNit = (i: ReviewInput) => {
  const sid = i.segments.find((s) => s.path === "big_picture[2].text")!.sid;
  return reviewerJson(i, { [sid]: { l: "unsupported", e: "근거 없음", n: "기사에 없음" } }, { verdict: "FIXABLE" });
};

function weeklyHarness(row: BriefingRow, replies: ((input: ReviewInput) => unknown)[]) {
  const inputs = new Map([[row.id, weeklyInput(row)]]);
  const h = harness(replies, inputs);
  // 이 버전은 수정 2회째로 만들어졌다 → 이번 검토가 마지막 차례(round 2)
  h.deps.producedByRound = async (id) => (id === row.id ? 1 : 2);
  h.deps.saveFixed = async (input, content) => {
    h.saved.push(content);
    const next = weeklyRow({ id: "fixed-w", version: input.row.version + 1, content: content as BriefingRow["content"] });
    inputs.set("fixed-w", weeklyInput(next));
    return { id: "fixed-w", version: next.version };
  };
  return h;
}

test("주간 마지막 차례: 확인 검토의 작은 지적은 문장을 지우기만 하고 새 버전을 발행 (다시 검토하지 않음)", async () => {
  const row = weeklyRow();
  const h = weeklyHarness(row, [weeklyNit]);
  const r = await runReviewPipeline({ briefingId: row.id, editionType: "weekly", policy }, h.deps);
  assert.equal(h.chats, 1);
  assert.equal(h.saved.length, 1);
  const bp = (h.saved[0] as { big_picture: { text: string }[] }).big_picture;
  assert.ok(!bp.some((b) => b.text.includes("오픈소스로 배포된다")), "지적된 문장이 지워져야 한다");
  assert.deepEqual(h.published, [{ id: "fixed-w", version: row.version + 1 }]);
  assert.match(r.processed[0].message, /마지막 차례 지우기 1문장/);
});

test("주간 마지막 차례: 지우면 큰 흐름이 2개 미만이 되면 초안 유지", async () => {
  const content = structuredClone(WEEKLY_CONTENT);
  content.big_picture = content.big_picture.slice(1); // 2개만 → 하나를 지우면 1개
  const row = weeklyRow({ content: content as unknown as BriefingRow["content"] });
  const nit = (i: ReviewInput) => {
    const sid = i.segments.find((s) => s.path === "big_picture[1].title")!.sid;
    return reviewerJson(i, { [sid]: { l: "unsupported", e: "근거 없음", n: "기사에 없음" } }, { verdict: "FIXABLE" });
  };
  const h = weeklyHarness(row, [nit]);
  const r = await runReviewPipeline({ briefingId: row.id, editionType: "weekly", policy }, h.deps);
  assert.equal(h.published.length, 0);
  assert.match(r.processed[0].steps.at(-1)!.detail, /마지막 지우기 불가/);
});

test("데일리 마지막 차례는 지우기 발행을 하지 않는다 (예전처럼 초안 유지)", async () => {
  const inputs = new Map([[ORIG.id, fakeInput(ORIG)]]);
  const h = harness([fixable], inputs);
  h.deps.producedByRound = async () => 1;
  await runReviewPipeline({ briefingId: ORIG.id, policy }, h.deps);
  assert.equal(h.published.length, 0);
});

test("월간 마지막 차례도 지우기만 하고 발행 (2026-11-10 월간 합본 결정)", async () => {
  const row = weeklyRow({ edition_type: "monthly" });
  const h = weeklyHarness(row, [weeklyNit]);
  await runReviewPipeline({ briefingId: row.id, editionType: "monthly", policy }, h.deps);
  assert.equal(h.published.length, 1);
});
