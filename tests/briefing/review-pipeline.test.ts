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
import { dailyRow, fakeInput, reviewerJson } from "./review-fixtures";

interface Harness {
  deps: PipelineDeps;
  published: { id: string; version: number }[];
  saved: Record<string, unknown>[];
  decisions: { reviewId: string; decision: Record<string, unknown> }[];
  stored: { trigger: string; round: number; verdict: string | null }[];
  chats: number;
}

function harness(replies: ((input: ReviewInput) => unknown)[], inputs: Map<string, ReviewInput>): Harness {
  const h: Harness = { deps: null as unknown as PipelineDeps, published: [], saved: [], decisions: [], stored: [], chats: 0 };
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
    retranslate: async () => [
      { locale: "en", content: { headline: "x" }, candidate: null, problems: [], repaired: false, usages: [] },
      { locale: "zh", content: { headline: "x" }, candidate: null, problems: [], repaired: false, usages: [] },
    ],
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
