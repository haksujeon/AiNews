/**
 * AI 검토(review/*) 단위 테스트 — 실행: npm run test:unit
 *  - 스키마 검증 (모르는 문장·라벨·후보 버림, 최상위 모양 오류)
 *  - 점수·판정 (사람 감사 기준표 그대로)
 *  - 자동 발행 정책 결정표
 *  - 수정 적용은 텍스트를 지어내지 않는다 (근거 없는 숫자·이름·최상급·인용 거절 → 삭제, 빈 필드는 항목 삭제·대체)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { ReviewSchemaError, claimTypeOf, parseReviewJson } from "../../src/lib/briefing/review/schema";
import { RUBRIC_PASS_SCORE, scoreReview, stricter, verdictOfRecommendation } from "../../src/lib/briefing/review/score";
import { decide, policyFromEnv, type DecisionInput } from "../../src/lib/briefing/review/policy";
import { checkReplacement, planFixes, quoteFound, quoteMatch } from "../../src/lib/briefing/review/fix";
import { applySegmentEdits, segmentContent } from "../../src/lib/briefing/review/segments";
import { compareEdition, itemKey } from "../../src/lib/briefing/review/calibrate";
import type { ReviewClaim, ReviewResult } from "../../src/lib/briefing/review/types";
import { A1, A2, DAILY_CONTENT, fakeInput, reviewerJson } from "./review-fixtures";

const input = fakeInput();
const ctx = { segments: input.segments, refLabels: input.refLabels, candidates: input.candidates, claimTypeOf };

// ───────────────────────── 문장 나누기

test("segmentContent: 필드·문장 단위 S id, 짧은 필드는 통째로", () => {
  const segs = segmentContent(DAILY_CONTENT, "daily");
  assert.equal(segs[0].path, "headline");
  assert.equal(segs[0].whole, true);
  assert.deepEqual(segs.filter((s) => s.path === "lede").map((s) => s.text), ["즈푸가 GLM-6를 공개했다.", "매개변수는 1조 2천억 개다.", "문샷AI는 10억 달러를 유치했다."]);
  const kn = segs.find((s) => s.path === "key_numbers[0]")!;
  assert.equal(kn.text, "1조 2천억 개 — GLM-6 매개변수");
  assert.deepEqual(kn.refs, [A1]);
  assert.ok(segs.every((s, i) => s.sid === `S${String(i + 1).padStart(2, "0")}`));
});

// ───────────────────────── 스키마

test("parseReviewJson: 모르는 문장·라벨·후보는 버리고 기록, 라벨 별칭 허용, ref 는 uuid 로", () => {
  const raw = {
    claims: [
      { s: "S01", c: "최대 모델", l: "overclaim", r: "a01", e: "智谱发布GLM-6", n: "최대 근거 없음" },
      { s: "S99", c: "?", l: "correct" },
      { s: "S02", c: "x", l: "made-up" },
      { s: "S03", c: "y", l: "number_unit", r: "A01, a09" },
    ],
    fixes: [{ s: "S01", a: "replace", t: "즈푸, GLM-6 공개", e: "智谱发布GLM-6" }, { s: "S02", a: "rewrite" }],
    omissions: [{ c: "C1", important: true, why: "큼" }, { c: "C7", important: true }],
    verdict: "fixable",
  };
  const p = parseReviewJson(raw, ctx);
  assert.equal(p.claims.length, 2);
  assert.equal(p.claims[1].label, "number-unit");
  assert.deepEqual(p.claims[1].ref_ids, [A1]);
  assert.equal(p.claims[0].claim_type, "headline");
  assert.equal(p.fixes.length, 1);
  assert.equal(p.fixes[0].original, input.segments[0].text, "원문은 모델이 아니라 코드가 채운다");
  assert.equal(p.omissions.length, 1);
  assert.equal(p.llmVerdict, "FIXABLE");
  assert.ok(p.schemaIssues.some((x) => x.includes("S99")));
  assert.ok(p.schemaIssues.some((x) => x.includes("made-up")));
  assert.ok(p.schemaIssues.some((x) => x.includes("C7")));
  assert.ok(p.schemaIssues.some((x) => x.startsWith("주장으로 다루지 않은 문장")));
});

test("parseReviewJson: 최상위 모양이 틀리면 ReviewSchemaError", () => {
  assert.throws(() => parseReviewJson(null, ctx), ReviewSchemaError);
  assert.throws(() => parseReviewJson({ verdict: "PASS" }, ctx), ReviewSchemaError);
  assert.throws(() => parseReviewJson([], ctx), ReviewSchemaError);
});

test("claimTypeOf: 감사 기준표의 claim_type", () => {
  assert.equal(claimTypeOf("top_stories[2].why"), "top_why");
  assert.equal(claimTypeOf("sections[0].items[1]"), "section");
  assert.equal(claimTypeOf("big_picture[1].text"), "big_picture");
  assert.equal(claimTypeOf("month_arc[0].text"), "month_arc");
});

// ───────────────────────── 점수·판정

const claim = (path: string, label: ReviewClaim["label"]): ReviewClaim => ({ sid: "S01", path, claim_type: "", claim: "", label, ref: null, ref_ids: [], evidence: "", note: "" });

test("scoreReview: 감사 W44 v5 의 감점 내역과 같은 점수 (1.5)", () => {
  const claims = [claim("headline", "wrong"), claim("big_picture[3].text", "wrong"), claim("money.text", "unsupported"), claim("money.text", "overclaim"), claim("movers[1].text", "misattributed"), claim("dek", "correct")];
  const r = scoreReview(claims, [{ important: true }, { important: true }, { important: true }], 1);
  assert.equal(r.score, 1.5);
  assert.equal(r.rubricVerdict, "FAIL");
  assert.equal(r.headLedeErrors, 1);
});

test("scoreReview: 판정 경계 — PASS 는 기준 점수 이상 + wrong/number-unit 0, 누락·구조 감점 상한", () => {
  assert.equal(scoreReview([claim("lede", "correct")], [], 0).rubricVerdict, "PASS");
  assert.equal(scoreReview([claim("top_stories[0].what", "overclaim"), claim("x", "overclaim")], [], 0).score, 8.5);
  assert.equal(scoreReview([claim("x", "overclaim"), claim("y", "overclaim")], [], 0).rubricVerdict, "PASS");
  assert.equal(scoreReview([claim("x", "overclaim"), claim("y", "overclaim"), claim("z", "misattributed")], [], 0, { passScore: RUBRIC_PASS_SCORE }).rubricVerdict, "FIXABLE");
  assert.equal(scoreReview([claim("sections[0].items[0]", "wrong")], [], 0).rubricVerdict, "FIXABLE", "본문 wrong 1건은 수정 후 발행");
  assert.equal(scoreReview([claim("lede", "number-unit")], [], 0).rubricVerdict, "FAIL", "lede 의 number-unit 은 재생성");
  const many = Array.from({ length: 10 }, () => ({ important: true }));
  assert.equal(scoreReview([], many, 20).score, 6.5, "누락 −2, 구조 −1.5 상한");
});

test("stricter / verdictOfRecommendation", () => {
  assert.equal(stricter("PASS", "FIXABLE"), "FIXABLE");
  assert.equal(stricter("FAIL", "PASS"), "FAIL");
  assert.equal(stricter("PASS", null), "PASS");
  assert.equal(verdictOfRecommendation("발행 가능"), "PASS");
  assert.equal(verdictOfRecommendation("재생성 필요"), "FAIL");
  assert.equal(verdictOfRecommendation("수정 후 발행"), "FIXABLE");
});

// ───────────────────────── 정책 결정표

const policy = policyFromEnv({});
const counts = (o: Partial<Record<string, number>> = {}) => ({ correct: 30, unsupported: 0, wrong: 0, misattributed: 0, overclaim: 0, "number-unit": 0, total: 30, ...o });
const base = (o: Partial<DecisionInput> = {}, r: Partial<ReviewResult> = {}): DecisionInput => ({
  review: { status: "done", verdict: "PASS", score: 9, counts: counts(), translation: [], ...r } as DecisionInput["review"],
  editionType: "daily",
  deterministicFatal: 0,
  translations: [{ locale: "en", status: "draft", problems: 0 }, { locale: "zh", status: "draft", problems: 0 }],
  incompleteDays: [],
  publishable: { ok: true, detail: "최신" },
  ...o,
});

test("policyFromEnv: 기본값과 스위치", () => {
  assert.equal(policy.autoPublish, true);
  assert.deepEqual(policy.minScore, { daily: 8, periodic: 7.5 });
  assert.equal(policy.maxOverclaim, 1);
  assert.equal(policy.maxUnsupported, 0);
  assert.equal(policyFromEnv({ BRIEFING_AUTO_PUBLISH: "off" }).autoPublish, false);
  assert.equal(policyFromEnv({ BRIEFING_REVIEW_MIN_SCORE_DAILY: "8.5" }).minScore.daily, 8.5);
});

test("decide: 결정표", () => {
  const cases: [string, DecisionInput, boolean][] = [
    ["모두 통과", base(), true],
    ["FIXABLE", base({}, { verdict: "FIXABLE" }), false],
    ["wrong 1", base({}, { counts: counts({ wrong: 1 }) }), false],
    ["number-unit 1", base({}, { counts: counts({ "number-unit": 1 }) }), false],
    ["misattributed 1", base({}, { counts: counts({ misattributed: 1 }) }), false],
    ["overclaim 1 허용", base({}, { counts: counts({ overclaim: 1 }) }), true],
    ["overclaim 2", base({}, { counts: counts({ overclaim: 2 }) }), false],
    ["unsupported 1", base({}, { counts: counts({ unsupported: 1 }) }), false],
    ["데일리 7.9점", base({}, { score: 7.9 }), false],
    ["데일리 8.0점", base({}, { score: 8 }), true],
    ["주간 7.5점", base({ editionType: "weekly", translations: undefined }, { score: 7.5 }), true],
    ["주간 7.4점", base({ editionType: "weekly", translations: undefined }, { score: 7.4 }), false],
    ["주간 결손일", base({ editionType: "weekly", incompleteDays: ["2026-10-31"] }), false],
    ["zh 번역 failed", base({ translations: [{ locale: "en", status: "draft", problems: 0 }, { locale: "zh", status: "failed", problems: 2 }] }), false],
    ["en 번역 없음", base({ translations: [{ locale: "zh", status: "draft", problems: 0 }] }), false],
    ["번역 major", base({}, { translation: [{ locale: "en", path: "lede", severity: "major", issue: "숫자" }] }), false],
    ["번역 minor 는 통과", base({}, { translation: [{ locale: "en", path: "lede", severity: "minor", issue: "어색" }] }), true],
    ["결정적 치명", base({ deterministicFatal: 1 }), false],
    ["고칠 수 없음", base({ unfixable: ["lede"] }), false],
    ["더 새 버전", base({ publishable: { ok: false, detail: "v4" } }), false],
    ["검토 오류", base({}, { status: "error", counts: null, error: "timeout" }), false],
  ];
  for (const [name, inp, want] of cases) assert.equal(decide(inp, policy).eligible, want, name);
  const off = decide(base(), policyFromEnv({ BRIEFING_AUTO_PUBLISH: "off" }));
  assert.equal(off.eligible, true);
  assert.equal(off.publish, false, "스위치가 꺼지면 발행하지 않는다");
  assert.equal(decide(base(), policy).publish, true);
});

// ───────────────────────── 수정은 지어내지 않는다

test("quoteFound / quoteMatch: 그대로·근사·숫자 다름", () => {
  const corpus = "融资规模有望超过SpaceX的860亿美元，成为史上最大IPO。";
  assert.equal(quoteFound("有望超过SpaceX的860亿美元", corpus), true);
  assert.equal(quoteMatch("上市规模有望超过SpaceX的860亿美元，成为史上最大IPO", corpus), "fuzzy");
  assert.equal(quoteMatch("融资规模有望超过SpaceX的960亿美元", corpus), "none", "숫자가 다르면 근사 일치도 아님");
  assert.equal(quoteMatch("전혀 다른 문장입니다 정말로", corpus), "none");
});

test("checkReplacement: 근거에 없는 숫자·로마자·최상급·인용은 거절, 근거대로 고친 문장은 통과", () => {
  const corpus = input.fullText.get(A1)!;
  const orig = "즈푸 GLM-6 공개, 중국 최대 모델";
  assert.equal(checkReplacement(orig, "즈푸, GLM-6 공개", "智谱发布GLM-6", corpus).ok, true);
  assert.match(checkReplacement(orig, "즈푸, GLM-7 공개", "智谱发布GLM-6", corpus).reasons.join(), /로마자|숫자/);
  assert.match(checkReplacement(orig, "즈푸, GLM-6 공개… 매개변수 3조 개", "智谱发布GLM-6", corpus).reasons.join(), /숫자/);
  assert.match(checkReplacement(orig, "즈푸, GLM-6 공개", "智谱宣布全球第一", corpus).reasons.join(), /인용/);
  assert.match(checkReplacement(orig, "즈푸, GLM-6 공개", "", corpus).reasons.join(), /인용 없음/);
  assert.match(checkReplacement("즈푸가 GLM-6를 공개했다.", "즈푸가 세계 최초로 GLM-6를 공개했다.", "智谱发布GLM-6", corpus).reasons.join(), /최상급|최초/);
  assert.match(checkReplacement("즈푸가 GLM-6를 공개했다.", "즈푸가 GLM-6를 공개해 엔비디아 주가가 폭락했다.", "智谱发布GLM-6", corpus).reasons.join(), /표현 비율|최상급/);
});

test("planFixes: 근거 확인된 replace 만 바꾸고, 수정안 없음·근거 미확인·misattributed 는 삭제, correct 문장 수정안은 버림", () => {
  const raw = reviewerJson(input, {
    S01: { l: "overclaim", e: "智谱发布GLM-6", n: "최대 근거 없음" },
    S04: { l: "misattributed", r: "a01", e: "月之暗面完成10亿美元融资", n: "다른 기사" },
    S07: { l: "number-unit", e: "参数量达1.2万亿", n: "x" },
    S08: { l: "unsupported", e: "근거 없음", n: "x" },
  }, {
    fixes: [
      { s: "S01", a: "replace", t: "즈푸, GLM-6 공개", e: "智谱发布GLM-6" },
      { s: "S04", a: "replace", t: "문샷AI는 10억 달러를 유치했다.", e: "月之暗面完成10亿美元融资" },
      { s: "S07", a: "replace", t: "매개변수는 5조 개다.", e: "参数量达1.2万亿" },
      { s: "S12", a: "replace", t: "GLM-6는 폐쇄형이다.", e: "x" },
    ],
  });
  const p = parseReviewJson(raw, ctx);
  const plan = planFixes(input.segments, p.claims, p.fixes, (seg) => seg.refs.map((r) => input.fullText.get(r)).join(" "));
  const by = new Map(plan.planned.map((x) => [x.sid, x]));
  assert.equal(by.get("S01")!.action, "replace");
  assert.equal(by.get("S04")!.action, "delete", "misattributed 는 refs 를 못 고치므로 삭제");
  assert.equal(by.get("S07")!.action, "delete", "근거에 없는 숫자(5조) → 삭제");
  assert.equal(by.get("S07")!.basis, "rejected_replace_deleted");
  assert.equal(by.get("S08")!.basis, "no_fix_deleted");
  assert.ok(plan.ignored.some((x) => x.sid === "S12"), "correct 문장 수정안은 버린다");

  // 적용 결과의 모든 문장은 원문 문장이거나 채택된 replace 문장이다 (그 밖의 글은 생기지 않는다)
  const out = applySegmentEdits(input.row.content, "daily", input.segments, plan.edits);
  const allowed = new Set([...input.segments.map((s) => s.text), ...plan.planned.filter((x) => x.action === "replace").map((x) => x.text)]);
  for (const s of segmentContent(out.content, "daily")) assert.ok(allowed.has(s.text), `지어낸 문장 없음: ${s.text}`);
  const c = out.content as typeof DAILY_CONTENT;
  assert.equal(c.headline, "즈푸, GLM-6 공개");
  assert.equal(c.lede, "즈푸가 GLM-6를 공개했다. 매개변수는 1조 2천억 개다.");
  assert.equal(c.top_stories.length, 1, "why 가 비면 주요 기사 통째로 삭제");
  assert.equal(c.top_stories[0].title, "문샷AI, 10억 달러 유치");
  assert.equal(c.top_stories[0].rank, 1, "순위를 다시 매긴다");
  assert.deepEqual(out.dropped, ["top_stories[0]"]);
});

test("applySegmentEdits: 헤드라인 삭제 → 1위 기사 제목, lede 가 비면 고칠 수 없음, 숫자 항목 삭제", () => {
  const segs = input.segments;
  const head = segs.find((s) => s.path === "headline")!.sid;
  const r1 = applySegmentEdits(input.row.content, "daily", segs, [{ sid: head, action: "delete" }]);
  assert.equal((r1.content as typeof DAILY_CONTENT).headline, "즈푸, GLM-6 공개");
  assert.deepEqual(r1.fallbacks, ["headline"]);
  const lede = segs.filter((s) => s.path === "lede").map((s) => ({ sid: s.sid, action: "delete" as const }));
  assert.ok(applySegmentEdits(input.row.content, "daily", segs, lede).unfixable.some((u) => u.startsWith("lede")));
  const kn = segs.find((s) => s.path === "key_numbers[0]")!.sid;
  const r3 = applySegmentEdits(input.row.content, "daily", segs, [{ sid: kn, action: "delete" }]);
  assert.equal((r3.content as typeof DAILY_CONTENT).key_numbers.length, 0);
  const r4 = applySegmentEdits(input.row.content, "daily", segs, [{ sid: kn, action: "replace", text: "1.2조 개 — GLM-6 매개변수 수" }]);
  assert.deepEqual((r4.content as typeof DAILY_CONTENT).key_numbers[0], { value: "1.2조 개", label: "GLM-6 매개변수 수", ref: A1 });
  // 원본은 바뀌지 않는다
  assert.equal(input.row.content.headline, DAILY_CONTENT.headline);
  assert.ok(A2);
});

test("applySegmentEdits: 주간 dek 가 비면 지표 문장 대체, 큰 흐름 text 가 비면 항목 삭제", () => {
  const weekly = {
    headline: "앤트로픽 쏠림", dek: "앤트로픽이 가장 많이 언급됐다.", dek_refs: [A1], dek_metrics: ["ent.anthropic"],
    big_picture: [{ title: "상장", text: "앤트로픽이 상장 서류를 냈다.", refs: [A1], metrics: [] }, { title: "자금", text: "자금이 몰렸다.", refs: [A2], metrics: [] }],
    movers: [], money: null, china_lens: null, watch_next: [], term: null, month_arc: [],
  };
  const segs = segmentContent(weekly, "weekly");
  const dek = segs.find((s) => s.path === "dek")!.sid;
  const bp = segs.find((s) => s.path === "big_picture[1].text")!.sid;
  const r = applySegmentEdits(weekly, "weekly", segs, [{ sid: dek, action: "delete" }, { sid: bp, action: "delete" }], { dek: () => ({ text: "이번 주 기사 562건.", metrics: ["vol.total"] }) });
  const c = r.content as typeof weekly;
  assert.equal(c.dek, "이번 주 기사 562건.");
  assert.equal(c.big_picture.length, 1);
  assert.deepEqual(r.fallbacks, ["dek"]);
});

// ───────────────────────── 보정 비교

test("itemKey / compareEdition: 감사 경로 별칭과 같은 항목 매칭", () => {
  assert.equal(itemKey("bp[2]"), "big_picture[2]");
  assert.equal(itemKey("big_picture[2].text"), "big_picture[2]");
  assert.equal(itemKey("companies[1]"), "companies_to_watch[1]");
  assert.equal(itemKey("arc[W42]"), "month_arc");
  assert.equal(itemKey("money[0]"), "money");
  assert.equal(itemKey("top_stories[1].what"), "top_stories[1]");
  const human = [{ path: "lede", claim: "문샷AI 10억 달러 유치", label: "wrong" }, { path: "headline", claim: "중국 최대", label: "overclaim" }, { path: "lede", claim: "즈푸 공개", label: "correct" }];
  const rv: ReviewClaim[] = [
    { ...claim("lede", "unsupported"), claim: "문샷AI가 10억 달러를 유치" },
    { ...claim("top_stories[0].why", "overclaim"), claim: "경쟁" },
  ];
  const c = compareEdition("t", human, rv);
  assert.equal(c.humanErrors[0].found, true);
  assert.equal(c.humanErrors[0].exactLabel, false);
  assert.equal(c.humanErrors[1].found, false);
  assert.equal(c.reviewerErrors[1].matched, false, "사람 오류가 없는 항목 = 거짓 경보");
});

// ───────────────────────── 응답 파싱 (보정에서 실제로 난 오류)

test("parseLenient: 문자열 안 줄바꿈·이스케이프 안 된 큰따옴표를 고쳐 읽는다", async () => {
  const { parseLenient, escapeInnerQuotes } = await import("../../src/lib/briefing/review/review");
  assert.deepEqual(parseLenient('{"a":"줄\n바꿈"}'), { a: "줄 바꿈" });
  const bad = '{"claims":[{"s":"S01","n":"근거는 "가능성"으로만 서술","l":"overclaim"}],"verdict":"PASS"}';
  assert.equal((parseLenient(bad) as { claims: { n: string }[] }).claims[0].n, '근거는 "가능성"으로만 서술');
  assert.equal(escapeInnerQuotes('{"a":"x"}'), '{"a":"x"}');
  const early = '{"claims":[],"fixes":[{"s":"S01","a":"delete"}]},\n"omissions":[],"verdict":"FAIL"}';
  assert.deepEqual(parseLenient(early), { claims: [], fixes: [{ s: "S01", a: "delete" }], omissions: [], verdict: "FAIL" });
});
