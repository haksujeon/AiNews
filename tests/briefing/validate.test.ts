/**
 * 브리핑 검증기 단위 테스트 — 실행: npm run test:unit
 * fixture: 프로토타입이 2026-10-13 기사 70건으로 실제 생성한 ko 브리핑 (sample-ko-2026-10-13.json)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { BriefingContent, CandidateArticle, CandidateGroup } from "../../src/lib/briefing/types";
import { contextFromGroups, dropFatalItems, normalizeContent, validateKo } from "../../src/lib/briefing/validate";
import { checkTranslation, numericValues } from "../../src/lib/briefing/translate";

const FIX = join(__dirname, "fixtures");
type FixtureArticle = CandidateArticle & { short_id: string };
const articles: FixtureArticle[] = JSON.parse(readFileSync(join(FIX, "articles-2026-10-13.json"), "utf8"));
const sample = JSON.parse(readFileSync(join(FIX, "sample-ko-2026-10-13.json"), "utf8")).briefing;

const groups: CandidateGroup[] = articles.map((a) => ({
  shortId: a.short_id,
  primary: a,
  siblings: [],
  sources: [a.source_name],
  score: 0,
  scoreDetail: {},
}));

function load(): BriefingContent {
  return normalizeContent(structuredClone(sample)).content;
}
function run(content: BriefingContent, hidden: string[] = []) {
  return validateKo(content, contextFromGroups(groups, "normal", new Set(hidden)));
}

test("샘플: '2위' 를 숫자+단위 위반으로 잡는다 (원문은 '2점 뒤졌고')", () => {
  const { report } = run(load());
  const hit = report.fatal.filter((f) => f.rule === "number_unit_not_in_source");
  assert.equal(hit.length, 1, JSON.stringify(report.fatal));
  assert.equal(hit[0].path, "top_stories[1].what");
  assert.match(hit[0].detail, /2위/);
  // 단순 숫자 검사는 모두 통과 (프로토타입 56/56)
  assert.equal(report.fatal.filter((f) => f.rule === "number_not_in_source").length, 0, JSON.stringify(report.fatal));
});

test("샘플: refs 관련성 — Meta 문장의 A16(DeepSeek) 만 떼어내고 A44 는 정상", () => {
  const { report, content } = run(load());
  assert.deepEqual(report.droppedRefs, [{ path: "sections[0].items[0]", ref: "A16" }]);
  assert.deepEqual(content.sections[0].items[0].refs, ["A47"]);
  assert.deepEqual(content.sections[0].items[1].refs, ["A44"]);
  assert.ok(report.warn.some((w) => w.rule === "refs_relevance" && /A16/.test(w.detail)));
  assert.ok(!report.warn.some((w) => w.rule === "refs_relevance" && /A44/.test(w.detail)));
});

test("샘플: 한국어 본문의 한자를 경고로 잡는다 (無問芯穹, 不问凡尘)", () => {
  const { report } = run(load());
  const han = report.warn.filter((w) => w.rule === "han_in_ko");
  assert.ok(han.length >= 3, JSON.stringify(han));
  assert.ok(han.some((w) => w.detail.includes("無問芯穹")));
  assert.ok(han.some((w) => w.detail.includes("不问凡尘")));
  // 용어 블록의 원어는 예외
  assert.ok(!han.some((w) => w.path.startsWith("term_of_the_day")));
});

test("샘플: 중국 중심 규칙 미달(상위 5건 중 2건)을 경고로 잡는다", () => {
  const { report } = run(load());
  assert.equal(report.stats.chinaCentric, 2);
  assert.ok(report.warn.some((w) => w.rule === "china_centric"));
});

test("샘플: 용어(自主复制) 와 병음은 통과", () => {
  const { report } = run(load());
  assert.equal(report.fatal.filter((f) => f.rule === "term").length, 0);
});

test("clusters 엄격 정의: 주제 묶음('AI 칩·메모리…', '구현형 AI…')은 빼고 같은 주체 사건(메타)은 유지", () => {
  const { report, content } = run(load());
  const stories = content.clusters.map((c) => c.story);
  assert.ok(stories.includes("메타 Muse Wonder 출시와 평가 논란"), stories.join(" | "));
  assert.ok(!stories.includes("AI 칩·메모리 공급과 중국 국산화"));
  assert.ok(!stories.includes("구현형 AI(具身智能) 상업화"));
  assert.ok(report.warn.some((w) => w.rule === "cluster_topic"));
});

test("용어 병음 띄어쓰기만 다르면 DB 표기로 교정(경고), 글자가 다르면 치명", () => {
  const c = load();
  c.term_of_the_day!.pinyin = "zìzhǔ fùzhì";
  const { report, content } = run(c);
  assert.equal(report.fatal.filter((f) => f.rule === "term").length, 0);
  assert.equal(content.term_of_the_day!.pinyin, "zì zhǔ fù zhì");
  assert.ok(report.warn.some((w) => w.rule === "term_pinyin_spacing"));
});

test("존재하지 않는 id 는 치명", () => {
  const c = load();
  c.sections[1].items[0].refs = ["A99"];
  const { report } = run(c);
  assert.ok(report.fatal.some((f) => f.rule === "unknown_ref" && f.path === "sections[1].items[0]"));
});

test("숨긴 기사·제외한 기사 인용은 치명", () => {
  const hidden = run(load(), ["A36"]).report;
  assert.ok(hidden.fatal.some((f) => f.rule === "excluded_or_hidden_ref" && f.path.startsWith("top_stories[2]")));
  const c = load();
  c.key_numbers[0].ref = "A11"; // LLM 스스로 excluded 에 넣은 다카이치 기사
  const ex = run(c).report;
  assert.ok(ex.fatal.some((f) => f.rule === "excluded_or_hidden_ref" && f.path === "key_numbers[0]"));
  // 2026-10-13 v7 회귀: headline 은 본문 전체 refs 를 쓰므로 ref 위반을 headline 에 붙이면 판 전체가 failed 가 됐다
  assert.ok(!ex.fatal.some((f) => f.path === "headline"), JSON.stringify(ex.fatal));
  assert.deepEqual(dropFatalItems(load(), ex.fatal).unrecoverable, []);
});

test("바꾼 숫자는 치명 (34% → 43%)", () => {
  const c = load();
  c.top_stories[2].what = c.top_stories[2].what.replace("34%", "43%");
  const { report } = run(c);
  assert.ok(report.fatal.some((f) => f.rule === "number_not_in_source" && f.path === "top_stories[2].what" && /43/.test(f.detail)));
});

test("refs 가 비면 치명, 용어 병음이 틀리면 치명", () => {
  const c = load();
  c.companies_to_watch[2].refs = [];
  c.term_of_the_day!.pinyin = "zi zhu fu zhi";
  const { report } = run(c);
  assert.ok(report.fatal.some((f) => f.rule === "missing_refs" && f.path === "companies_to_watch[2]"));
  assert.ok(report.fatal.some((f) => f.rule === "term"));
});

test("남은 치명 항목 삭제 후 재검증하면 치명 0, 주요 기사 4건 유지", () => {
  const first = run(load());
  const { content, dropped, unrecoverable } = dropFatalItems(first.content, first.report.fatal);
  assert.deepEqual(dropped, ["top_stories[1]"]);
  assert.deepEqual(unrecoverable, []);
  const again = run(content);
  assert.equal(again.report.fatal.length, 0, JSON.stringify(again.report.fatal));
  assert.equal(content.top_stories.length, 4);
  assert.deepEqual(content.top_stories.map((s) => s.rank), [1, 2, 3, 4]);
});

test("번역 재검증: 숫자 집합·문자 체계·구조", () => {
  const ko = load();
  const en = structuredClone(ko);
  en.headline = "From AI self-replication tests to Meta's new model";
  en.lede = "Anthropic researchers published results. Meta launched Muse Wonder. Infinigence raised 2.3 billion yuan.";
  ko.lede = "무문신궁이 단일 라운드 23억 위안을 조달했다.";
  const ok = checkTranslation(ko, en, "en");
  assert.ok(!ok.some((p) => p.includes("lede")), ok.join("\n"));
  const bad = structuredClone(en);
  bad.lede = "Infinigence raised 3.2 billion yuan (무문신궁).";
  const problems = checkTranslation(ko, bad, "en");
  assert.ok(problems.some((p) => p.includes("lede") && /number/.test(p)), problems.join("\n"));
  assert.ok(problems.some((p) => p.includes("lede") && /Hangul/.test(p)), problems.join("\n"));
  const raw = structuredClone(en);
  raw.lede = "Infinigence raised 2300000000 yuan."; // 2026-10-13 실제 출력 — 숫자 집합은 같지만 읽기 어려움
  assert.ok(checkTranslation(ko, raw, "en").some((p) => p.includes("lede") && /raw long number/.test(p)));
  const zh = structuredClone(ko);
  zh.lede = "无问芯穹单轮融资23亿元。";
  assert.ok(!checkTranslation(ko, zh, "zh").some((p) => p.includes("lede")));
  // 실제 생성에서 나온 단위 표기들 (2026-10-13 zh 재검증 오탐)
  assert.deepEqual([...numericValues("컨텍스트 500k 확대")], [...numericValues("上下文扩展至50万token")]);
  assert.deepEqual([...numericValues("1조 달러")], [...numericValues("1万亿美元")]);
  assert.deepEqual([...numericValues("5억 3,700만 명")], [...numericValues("537 million people")]);
  assert.deepEqual([...numericValues("57.2만 개")], [...numericValues("572,000 units")]);
  assert.deepEqual([...numericValues("약 500억 달러")], [...numericValues("50 Billion Dollar Valuation")]); // 제목 대문자
  assert.notDeepEqual([...numericValues("120개")], [...numericValues("2026年120个")]); // 연도를 덧붙이면 위반
  const shape = structuredClone(en);
  shape.top_stories = shape.top_stories.slice(1);
  assert.ok(checkTranslation(ko, shape, "en").some((p) => /structure/.test(p)));
});
