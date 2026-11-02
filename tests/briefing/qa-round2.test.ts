/**
 * 2026-11-02 재감사(v2) round 2 회귀 시험 — REPORT-v2 §5·§7 의 실패를 v2 판의 실제 문장으로 재현한다.
 * fixture: tests/briefing/fixtures/qa-2026-11-02-round2.json (판 문장 = editions.json, 근거 기사 = arts.json)
 * 실행: npm run test:unit
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { claimIssues, pastMarkerIssues, resolveMonthDay, staleDateIn, staleEventIssues, moneyIssues, type SourceDoc } from "../../src/lib/briefing/rules";
import {
  contextFromArticles,
  duplicateStoryIssues,
  droppedKeyStories,
  fitSentenceLengths,
  glossKoHan,
  localFixes,
  mergeDuplicateItems,
  normalizeContent,
  validateKo,
  type ValidationContext,
} from "../../src/lib/briefing/validate";
import { amountGrounded, maskGroundedQuantities, parseQuantities } from "../../src/lib/briefing/quantity";
import { checkTranslation, nameIssues, numericValues } from "../../src/lib/briefing/translate";
import {
  arcOffWeekRefs,
  changeUnbacked,
  directionConflicts,
  directionFlips,
  dropConflictSentences,
  pruneArcRefs,
  revertFlips,
  normalizeWeekly,
} from "../../src/lib/briefing/periodic/validate";
import { dealBeforePeriod, mergeSameDeals, moneyTable, sameAmountAcrossCurrencies, type PeriodArticle } from "../../src/lib/metrics/period";
import { headlinesEdition, shortFallback } from "../../src/lib/briefing/fallback";
import type { BriefingContent, CandidateArticle, CandidateGroup, TopStory } from "../../src/lib/briefing/types";

type Art = { id: string; source_name: string; d: string; category: string; title_kr: string; title_cn: string; summary_kr: string; summary_cn: string; ai_insights_kr: string; subject_region: string | null };
const FX = JSON.parse(readFileSync(join(__dirname, "fixtures", "qa-2026-11-02-round2.json"), "utf8")) as {
  articles: Record<string, Art>;
  editions: Record<string, unknown>;
};
const A = (k: string) => FX.articles[k];
const ED = <T = string>(k: string) => FX.editions[k] as T;
const doc = (a: Art): SourceDoc => ({ ...a, insight_kr: a.ai_insights_kr, news_date: a.d });
const cand = (a: Art): CandidateArticle => ({ ...a, source_url: null, key_terms: [], news_date: a.d });
const rules = (list: { rule: string }[]) => list.map((i) => i.rule);

// ───────────────────────── §7-1 시점: 미래 날짜, "지난 7월"

test("10-31 v4: '11월 4일 iOS 베타 테스트 시작'(앞으로 있을 일)을 작년 날짜로 되돌리지 않는다 — stale_event 없음", () => {
  const texts = ED<string[]>("d1031_sec_apple");
  assert.ok(texts.length >= 2);
  for (const text of texts) {
    assert.match(text, /11월 4일/);
    assert.equal(staleDateIn(text, "2026-10-31"), null);
    assert.deepEqual(staleEventIssues(text, [doc(A("apple_1031"))], "2026-10-31"), [], text);
  }
  // 원문 기사 문장도 예전 날짜가 아니다
  assert.equal(staleDateIn(A("apple_1031").title_kr, "2026-10-31"), null);
});

test("resolveMonthDay: 판 날짜에서 가장 가까운 해 (앞뒤 6개월) — 연말 판의 1월 일정은 다음 해, 연초 판의 12월은 지난해", () => {
  assert.equal(resolveMonthDay(11, 4, "2026-10-31"), "2026-11-04");
  assert.equal(resolveMonthDay(1, 5, "2026-12-28"), "2027-01-05");
  assert.equal(resolveMonthDay(12, 20, "2026-01-03"), "2025-12-20");
  assert.equal(resolveMonthDay(9, 8, "2026-10-28"), "2026-09-08");
  // 예전 시험 그대로 (qa-regression.test.ts): 9월 8일은 10-28 판에 예전 사건
  assert.equal(staleDateIn("OpenAI는 9월 8일 증명을 공개했다", "2026-10-28"), "2026-09-08");
});

test("07-15 리드 '지난 7월 중국 당국은 … 공개했다' — 판과 같은 달을 '지난 7월'로 씀 → time_marker_wrong, 결정적 수선은 '지난 ' 만 지움", () => {
  const lede = ED("d0715_ko_lede");
  assert.ok(rules(pastMarkerIssues(lede, "2026-07-15")).includes("time_marker_wrong"));
  assert.ok(rules(staleEventIssues(lede, [doc(A("oppo_0715"))], "2026-07-15")).includes("time_marker_wrong"));
  assert.deepEqual(pastMarkerIssues("지난 6월 공개한 모델", "2026-07-15"), []);
  assert.deepEqual(pastMarkerIssues("지난 7월 3일 공개한 모델", "2026-07-15"), []);
  const c = { ...emptyContent(), lede };
  const fixed = localFixes(c, [{ level: "fatal", rule: "time_marker_wrong", path: "lede", detail: "x" }]);
  assert.match(fixed.content.lede, /(?<!지난 )7월 중국 당국은/);
  assert.equal(fixed.edits[0].action, "time_marker");
});

test("07-15 initial 오탐: '중국 당국은 … 공개' 를 다른 기사의 '면벽지능은 2022년 8월 설립 … 칭화대' 와 같은 실체로 보지 않는다", () => {
  const s = "중국 당국은 애플 등 7개 휴대폰 온디바이스 생성형 AI 서비스의 등록 정보를 공개했다.";
  const got = staleEventIssues(s, [doc(A("minicpm_0715")), doc(A("oppo_0715"))], "2026-07-15");
  assert.deepEqual(rules(got), []);
});

// ───────────────────────── §7-2 금액 표기 정규화 (파서 하나)

test("금액 정규화: '162억 8,600만 달러' = '162.86억 달러' = '$16.286B' = '16.286 billion dollars' = '162.86亿美元'", () => {
  const v = (t: string) => parseQuantities(t).map((q) => [Math.round(q.value), q.currency]);
  const want = [[16_286_000_000, "USD"]];
  for (const t of ["162억 8,600만 달러", "162.86억 달러", "$16.286B", "16.286 billion dollars", "162.86亿美元"]) assert.deepEqual(v(t), want, t);
  assert.deepEqual([...numericValues("162억 8,600만 달러")], [...numericValues("$16.286B")]);
  assert.deepEqual([...numericValues("162억 8,600만 달러")], [...numericValues("162.86亿美元")]);
  assert.ok(amountGrounded("162억 8,600만 달러", A("anthropic_s1").summary_kr));
  assert.ok(!amountGrounded("162억 달러", A("anthropic_s1").summary_kr), "잘라 쓴 금액은 여전히 다른 값");
});

test("10-29 initial: key_numbers '162억 8,600만 달러' 가 원문 '162.86억 달러' 와 같은 값 → number/amount 치명 없음 (예전: 3건 치명 → S-1 소실)", () => {
  const a = A("anthropic_s1");
  const ctx = contextFromArticles([cand(a)], "short", new Set(), "2026-10-29");
  const c: BriefingContent = {
    ...emptyContent(),
    headline: "Anthropic 상장 신청서 제출",
    lede: "Anthropic이 나스닥 상장 신청서를 제출했다.",
    lede_refs: [a.id],
    top_stories: [top(1, "Anthropic", "Anthropic, 나스닥 상장 신청서 제출", "Anthropic이 나스닥 상장을 신청했다.", [a.id])],
    key_numbers: [{ value: "162억 8,600만 달러", label: "Anthropic 2026년 상반기 매출", ref: a.id }],
  };
  const r = validateKo(c, ctx).report;
  const kn = r.fatal.filter((f) => f.path.startsWith("key_numbers"));
  assert.deepEqual(kn, [], JSON.stringify(kn));
  assert.deepEqual(rules(moneyIssues("상반기 매출 162억 8,600만 달러", [doc(a)])), []);
  assert.equal(maskGroundedQuantities("매출 162억 8,600만 달러", a.summary_kr).masked[0], "162억 8,600만 달러");
});

// ───────────────────────── §7-11 번역: 작은 수·이름

test("09-16 zh '飞书10.0'(ko '페이수 8.0') — 10 이하 소수점 표기도 대조 → number set differs", () => {
  const ko = ED("d0916_ko_sec2_0");
  const zh = ED("d0916_zh_sec2_0");
  assert.notDeepEqual([...numericValues(ko)], [...numericValues(zh)]);
  const base = { ...emptyContent(), headline: "h", lede: "l", sections: [{ section: "products", items: [{ text: ko, refs: ["x"] }] }] };
  const tr = { ...emptyContent(), headline: "h", lede: "l", sections: [{ section: "products", items: [{ text: zh, refs: ["x"] }] }] };
  assert.ok(checkTranslation(base, tr, "zh").some((p) => p.startsWith("sections[0].items[0]") && /number set differs|digits/.test(p)));
  // 말로 쓴 작은 수(3개 → three)는 여전히 비교하지 않는다
  assert.deepEqual([...numericValues("후보 3개")], [...numericValues("three candidates")]);
});

test("round 2 재생성(10-28) 번역 오탐 회귀: 'Q3'·'score is 44, up 3 points'·'00-born'·'约六万名' 은 숫자 위반이 아니다", () => {
  const cases: [string, string, "en" | "zh"][] = [
    ["우수커지, 상장 후 첫 실적에서 매출은 55.71% 늘었으나 3분기 순이익은 감소", "Unitree's first results since listing: revenue up 55.71%, but Q3 net profit declined", "en"],
    [
      "앤트그룹 바이링 대모델이 10월 28일 Ling-3.1-flash-1019를 오픈소스로 공개했다. 지능 지수는 44점으로 이전 버전보다 3점 올랐다.",
      "Ant Group's Bailing model released Ling-3.1-flash-1019 as open source on October 28. Its intelligence index score is 44, up 3 points from the previous version.",
      "en",
    ],
    ["칭화대 00후 창업자 기업들, 잇따라 투자 유치 (장셴 과학기술 1년 내 누적 10억 위안 이상)", "Tsinghua 00-born founders' companies raise funding (Zhangxian Technology accumulates over 1 billion yuan in one year)", "en"],
    ["마이크로소프트, 약 6만 명 대상 자발적 퇴사 프로그램 실시", "微软向约六万名员工推出自愿离职计划", "zh"],
  ];
  for (const [ko, tr, target] of cases) {
    const base = { ...emptyContent(), headline: ko, lede: "l" };
    const got = checkTranslation(base, { ...base, headline: tr, lede: "l" }, target).filter((p) => p.startsWith("headline"));
    assert.deepEqual(got.filter((p) => /number|digits/.test(p)), [], `${tr}\n${got.join("\n")}`);
  }
  // 이름에 붙은 수는 여전히 본다: Genie 4 → Genie 3
  const base = { ...emptyContent(), headline: "구글 Genie 4 공개", lede: "l" };
  assert.ok(checkTranslation(base, { ...base, headline: "Google unveils Genie 3" }, "en").some((p) => /number set differs/.test(p)));
});

test("10-29 en 'Tianhai 300'(ko 천가오300 = 天垓300 → Tiangai) / 07-15 en 'Zhiyi Power'(ko 지지동력 = LimX Dynamics) → 이름표 위반", () => {
  const ko = ED<TopStory>("d1029_ko_top3");
  const en = ED<TopStory>("d1029_en_top3");
  assert.ok(nameIssues(ko.title, en.title, "en").some((p) => /Tiangai/.test(p)), en.title);
  assert.deepEqual(nameIssues(ko.title, en.title.replace("Tianhai", "Tiangai"), "en"), []);
  const ko2 = ED("d0715_ko_sec0_2");
  const en2 = ED("d0715_en_sec0_2");
  assert.ok(nameIssues(ko2, en2, "en").some((p) => /LimX/.test(p)), en2);
  assert.deepEqual(nameIssues(ko2, en2.replace("Zhiyi Power's", "LimX Dynamics'"), "en"), []);
  // zh 는 한자 표기
  assert.deepEqual(nameIssues(ko.title, "国产GPU天垓300现场测试称快于H200", "zh"), []);
});

// ───────────────────────── §7-3 한자·길이: 삭제 전에 결정적으로

test("10-27: '캡컷(剪映 국제판)' 한자 2자 — 괄호 안 한자를 지우고(사전 치환 포함) 주요 기사를 남긴다", () => {
  const c = { ...emptyContent(), top_stories: [top(1, "바이트댄스", "바이트댄스, 캡컷 ChatGPT 연동", "바이트댄스가 캡컷(剪映 국제판)을 ChatGPT에 연동한다고 밝혔다.", ["a"])] };
  const g = glossKoHan(c);
  assert.equal(g.content.top_stories[0].what, "바이트댄스가 캡컷(국제판)을 ChatGPT에 연동한다고 밝혔다.");
  assert.equal(g.edits[0].action, "gloss");
  assert.equal(glossKoHan({ ...c, top_stories: [{ ...c.top_stories[0], what: "剪映은 편집 앱이다. 千问 연동." }] }).content.top_stories[0].what, "젠잉은 편집 앱이다. 치엔원 연동.");
});

test("섹션 한 줄 76/70자 — 통째 삭제 대신 절 경계에서 자르고 기록을 남긴다", () => {
  const text = "OpenAI 내부 AI가 수학·컴퓨터과학·물리학에서 세 가지 발견을 했다고 밝혔으며, 연구진은 검증 절차를 공개할 계획이라고 덧붙였다";
  assert.ok(text.length > 70);
  const f = fitSentenceLengths({ ...emptyContent(), sections: [{ section: "research", items: [{ text, refs: ["a"] }] }] });
  const out = f.content.sections[0].items[0].text;
  assert.ok(out.length <= 70 && out.length >= 35, out);
  assert.equal(f.edits[0].action, "trim");
  assert.equal(f.edits[0].before, text);
});

test("10-30 why 의 '판도' 한 단어(trend_unsupported) — 여러 문장이면 그 문장만 지운다 (항목 통째 삭제 전)", () => {
  const why = "Pro 사용자의 사용 한도가 두 배로 늘었다. 구독형 AI 시장의 판도를 바꿀 수 있다.";
  const c = { ...emptyContent(), top_stories: [top(1, "OpenAI", "OpenAI Pro 한도 두 배", "OpenAI가 Pro 요금제 사용 한도를 두 배로 늘렸다.", ["a"], why)] };
  const fx = localFixes(c, [{ level: "fatal", rule: "trend_unsupported", path: "top_stories[0].why", detail: '"판도" — 근거 기사에 같은 표현이 없음' }]);
  assert.equal(fx.content.top_stories[0].why, "Pro 사용자의 사용 한도가 두 배로 늘었다.");
  assert.equal(fx.edits[0].action, "sentence_delete");
});

test("핵심 기사 삭제 경고: 여러 매체가 다룬 사건의 유일한 주요 기사가 빠지면 dropped_key_story (경고)", () => {
  const before = { ...emptyContent(), top_stories: [top(1, "Anthropic", "Anthropic S-1", "w", ["A01"]), top(2, "딥시크", "딥시크", "w", ["A02"])] };
  const after = { ...emptyContent(), top_stories: [top(1, "딥시크", "딥시크", "w", ["A02"])] };
  const ctx = { eventOutlets: new Map([["A01", 4], ["A02", 1]]) };
  const w = droppedKeyStories(before, after, ctx);
  assert.deepEqual(rules(w), ["dropped_key_story"]);
  assert.equal(w[0].level, "warn");
  assert.deepEqual(droppedKeyStories(before, { ...after, sections: [{ section: "industry", items: [{ text: "S-1", refs: ["A01"] }] }] }, ctx), []);
});

// ───────────────────────── §7-10 중복 0건

test("10-29: top[0] 와 sections[0].items[0] 이 같은 두 기사로 Gemini 4 Carbon 을 두 번 씀 → duplicate_story, 병합하면 섹션 줄이 빠지고 refs 는 top[0] 로", () => {
  const t0 = ED<TopStory>("d1029_ko_top0");
  const items = ED<{ text: string; refs: string[] }[]>("d1029_ko_sec0_items");
  const c = { ...emptyContent(), top_stories: [t0], sections: [{ section: "models", items }] };
  const ctx = { events: undefined };
  assert.deepEqual(rules(duplicateStoryIssues(c, ctx)), ["duplicate_story"]);
  const m = mergeDuplicateItems(c, ctx);
  assert.equal(m.content.sections[0].items.length, items.length - 1);
  assert.equal(m.edits[0].action, "merge");
  assert.deepEqual(duplicateStoryIssues(m.content, ctx), []);
});

test("같은 사건(사건 키가 같음)을 주요 기사 두 칸에 → 아래 칸을 위 칸에 합침. 다른 사건이 보조 기사 하나를 공유하면 그 ref 만 뗌", () => {
  const ctx: Pick<ValidationContext, "events"> = { events: new Map([["A01", "A01"], ["A02", "A01"], ["A03", "A03"], ["A04", "A04"]]) };
  const c = { ...emptyContent(), top_stories: [top(1, "구글", "Gemini 4", "w", ["A01"]), top(2, "구글", "알파벳 주가", "w", ["A02"]), top(3, "알리", "x", "w", ["A03", "A01"])] };
  assert.deepEqual(rules(duplicateStoryIssues(c, ctx)), ["duplicate_story", "shared_ref"]);
  const m = mergeDuplicateItems(c, ctx);
  assert.equal(m.content.top_stories.length, 2);
  assert.deepEqual(m.content.top_stories[0].refs, ["A01", "A02"]);
  assert.deepEqual(m.content.top_stories[1].refs, ["A03"]);
});

// ───────────────────────── §7-9 대체 판

test("대체 판: 짧은 판(검증 통과 주요 기사 ≥ 3, 결정적 헤드라인·리드) → 안 되면 제목만 판(mode headlines, LLM 문장 없음)", () => {
  const arts = ["apple_1031", "deepseek_801", "tiangai"].map((k) => cand(A(k)));
  const ctx = contextFromArticles(arts, "normal", new Set(), "2026-10-31");
  const tops = arts.map((a, i) => top(i + 1, "", a.title_kr.slice(0, 38), a.title_kr, [a.id]));
  const c = { ...emptyContent(), headline: "아주 긴 헤드라인이 상한을 넘어서 치명 위반이 되는 경우를 만든다", lede: "근거 없는 리드", lede_refs: [arts[0].id], top_stories: tops };
  const r = validateKo(c, ctx).report;
  const sf = shortFallback(c, r, ctx);
  assert.ok(sf, JSON.stringify(r.fatal));
  assert.deepEqual(sf!.report.fatal, []);
  assert.ok(sf!.content.headline.length <= 32);
  assert.equal(shortFallback({ ...c, top_stories: tops.slice(0, 2) }, r, ctx), null);
  const groups: CandidateGroup[] = arts.map((a, i) => ({ shortId: `A0${i + 1}`, primary: a, siblings: [], sources: [a.source_name], score: 10 - i, scoreDetail: {} }));
  const hl = headlinesEdition(groups, "2026-10-31");
  assert.equal(hl.headline, "10월 31일 중국 AI 주요 기사");
  assert.equal(hl.top_stories.length, 3);
  assert.equal(hl.top_stories[0].title, groups.find((g) => g.primary.subject_region === "CN")!.primary.title_kr);
  assert.match(hl.top_stories[0].what, /^보도: /);
});

// ───────────────────────── 주간·월간: §7-4 방향, §7-5 돈, §7-6 month_arc, §7-8 CHANGE_RE

test("W44 bp3: '딥시크 호출량 801% 급증'(기사 숫자) 은 ent.deepseek.chg(언급 −18%)와 충돌이 아니다 / 수리본 '크게 줄었다' 는 뒤집기 → 되돌림", () => {
  const facts = { "ent.deepseek.chg": "딥시크 -18%" };
  const ground = `${A("deepseek_801").title_kr} ${A("deepseek_801").summary_kr}`;
  const initial = "딥시크 신버전 모델의 단일 주간 호출량은 전주 대비 801% 급증했다. 바이두는 문서 파싱 모델을 오픈소스로 공개했다.";
  assert.deepEqual(directionConflicts(initial, ["ent.deepseek.chg"], facts, ground), []);
  assert.ok(directionConflicts(initial, ["ent.deepseek.chg"], facts).length, "근거 없이 보면 예전처럼 충돌");
  const flipped = ED<{ text: string }>("w44_bp3").text;
  assert.match(flipped, /크게 줄었다/);
  const before = weekly({ big_picture: [{ title: "t", text: initial, refs: ["S01"], metrics: ["ent.deepseek.chg"] }] });
  const after = weekly({ big_picture: [{ title: "t", text: flipped, refs: ["S01"], metrics: ["ent.deepseek.chg"] }] });
  assert.deepEqual(directionFlips(before, after, facts), ["big_picture[0]"]);
  const rv = revertFlips(before, after, ["big_picture[0]"], [], facts);
  assert.equal(rv.content.big_picture[0].text, initial);
  assert.equal(rv.edits[0].action, "flip_rejected");
  // 지표 값을 그대로 인용하면 방향을 바꿔 써도 된다
  const cited = weekly({ big_picture: [{ title: "t", text: "딥시크 언급은 딥시크 -18%로 줄었다. 바이두는 문서 파싱 모델을 오픈소스로 공개했다.", refs: ["S01"], metrics: [] }] });
  assert.deepEqual(directionFlips(before, cited, facts), []);
});

test("방향 충돌 문장은 수리 전에 그 문장만 지운다 (고쳐 쓰지 않음)", () => {
  const facts = { "term.智能体.fall": "智能体 84건→55건" };
  const text = "개인 에이전트 언급이 크게 늘었다. 앤트로픽은 상장 서류를 냈다.";
  const c = weekly({ big_picture: [{ title: "t", text, refs: ["S01"], metrics: ["term.智能体.fall"] }] });
  const d = dropConflictSentences(c, [{ level: "fatal", rule: "direction_conflict", path: "big_picture[0]", detail: "term.智能体.fall=智能体 84건→55건 인데 상승 표현" }], facts);
  assert.equal(d.content.big_picture[0].text, "앤트로픽은 상장 서류를 냈다.");
  assert.equal(d.edits[0].action, "sentence_delete");
});

test("W42 헤드라인 '에이전트·구체지능 열풍 속 …' / W41 '자금이 … 몰리는 모습' — 증감 지표 없으면 change_unbacked", () => {
  assert.ok(changeUnbacked(ED("w42_headline"), []));
  assert.ok(changeUnbacked(ED("w41_bp1"), []));
  assert.ok(!changeUnbacked(ED("w42_headline"), ["term.智能体.rise"]));
  assert.ok(!changeUnbacked("확산 방지 대책을 내놓았다", []));
});

test("W43 bp2 '검색 API 가격을 낮췄다' — 원문은 무료 → 11월 1일부터 유료화 → trend_unsupported", () => {
  const got = claimIssues(ED("w43_bp2"), [doc(A("deepseek_search"))]);
  assert.ok(got.some((i) => i.rule === "trend_unsupported" && /가격/.test(i.detail)), JSON.stringify(got));
});

test("W41 money: AMD–World Labs(9월 28일 발표, 10-07 후속 기사)는 기간 밖 거래 / TypeSafe 8.7억 달러 = 58.6억 위안 은 한 행", () => {
  const amd = A("amd_wl");
  assert.ok(dealBeforePeriod({ ...amd, day: amd.d }, "82억 달러", "2026-10-05"));
  assert.ok(!dealBeforePeriod({ ...amd, day: amd.d }, "82억 달러", "2026-09-28"));
  assert.ok(sameAmountAcrossCurrencies("8.7억 달러", "58.6억 위안"));
  assert.ok(!sameAmountAcrossCurrencies("8.7억 달러", "33억 위안"));
  const arts = ["amd_wl", "typesafe_usd", "typesafe_cny"].map((k) => periodArt(A(k)));
  const rows = moneyTable(arts, { start: "2026-10-05", end: "2026-10-11" });
  assert.ok(!rows.some((r) => r.id === amd.id), "AMD 행 빠짐");
  assert.equal(rows.length, 1, JSON.stringify(rows));
  assert.equal(rows[0].same_deal?.length, 1);
  // 범위 없이 부르면 예전 그대로 (통계 화면 호환)
  assert.equal(moneyTable(arts).length, 3);
  assert.equal(mergeSameDeals([]).length, 0);
});

test("월간 month_arc: 그 주에 날짜가 없는 사건 ref 는 arc_week_mismatch, 결정적 정리는 남는 ref 가 있을 때만 뗀다", () => {
  const ctx = {
    weekRanges: new Map([["W43", { start: "2026-10-19", end: "2026-10-25" }]]),
    sidDays: new Map([["S01", ["2026-10-26", "2026-10-27"]], ["S02", ["2026-10-21"]]]),
  };
  assert.deepEqual(arcOffWeekRefs({ week: "W43", refs: ["S01", "S02"] }, ctx), ["S01"]);
  const c = weekly({ month_arc: [{ week: "W43", text: "x", refs: ["S01", "S02"], metrics: [] }, { week: "W43", text: "y", refs: ["S01"], metrics: [] }] });
  const p = pruneArcRefs(c, ctx);
  assert.deepEqual(p.content.month_arc[0].refs, ["S02"]);
  assert.deepEqual(p.content.month_arc[1].refs, ["S01"], "남는 ref 가 없으면 그대로 — 검증이 그 칸을 뺀다");
});

// ───────────────────────── 도우미

function emptyContent(): BriefingContent {
  return normalizeContent({}).content;
}

function top(rank: number, subject: string, title: string, what: string, refs: string[], why = ""): TopStory {
  return { rank, section: "industry", subject, subject_is_chinese: false, title, what, why, refs, primary_ref: refs[0] };
}

function weekly(p: Partial<ReturnType<typeof normalizeWeekly>["content"]>) {
  return { ...normalizeWeekly({ headline: "h", dek: "d" }).content, ...p };
}

function periodArt(a: Art): PeriodArticle {
  return { ...a, day: a.d, sentiment: "neutral", key_terms: [], news_date: a.d } as unknown as PeriodArticle;
}
