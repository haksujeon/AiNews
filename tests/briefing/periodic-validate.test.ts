/**
 * 주간·월간 검증기 단위 테스트 — 실행: npm run test:unit
 * fixture: 2026-11-02 설계 검토 프로토타입이 실제 LLM(anthropic-api-haiku-5-5)으로 만든 주간·월간 원 출력과
 *          같은 S id 의 근거 텍스트·지표 사전 (tests/briefing/fixtures/periodic). 호출 없이 검증기만 다시 돌린다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseJsonContent } from "../../src/lib/briefing/llm";
import {
  changeUnbacked,
  crossCurrencyRank,
  directionConflicts,
  dropFatalPeriodic,
  irrelevantMetrics,
  needsRepair,
  normalizeWeekly,
  stripPeriodLabels,
  validateWeekly,
  volumeWowUnadjusted,
  type PeriodicValidationContext,
} from "../../src/lib/briefing/periodic/validate";

const FIX = join(__dirname, "fixtures", "periodic");
function load(kind: "weekly" | "monthly") {
  const fx = JSON.parse(readFileSync(join(FIX, `${kind}-llm-2026-11-02.json`), "utf8"));
  const ctx: PeriodicValidationContext = {
    kind,
    sourceText: new Map(Object.entries(fx.source_text as Record<string, string>)),
    facts: fx.facts,
    entityNames: new Map(Object.entries(fx.entity_names as Record<string, string>)),
    terms: new Set(fx.terms as string[]),
    headlineMax: 36,
  };
  const { content, issues } = normalizeWeekly(parseJsonContent(fx.raw_content));
  return { fx, ctx, content, issues };
}
const pick = (list: { rule: string; path: string }[]) => list.map((i) => `${i.rule}@${i.path}`).sort();

test("주간 실제 출력 회귀: 치명 2 (china_lens 근거 밖 기업) + 경고 5 (프로토타입 4 + 엄격한 제목 40/36)", () => {
  const { ctx, content, issues } = load("weekly");
  const r = validateWeekly(content, ctx, issues);
  assert.deepEqual(pick(r.fatal), ["unsupported_entity@china_lens", "unsupported_entity@china_lens"]);
  assert.deepEqual(r.fatal.map((f) => f.detail).sort(), ["anthropic", "google"]);
  assert.deepEqual(pick(r.warn), [
    "direction_conflict@big_picture[2]",
    "han_in_ko@big_picture[1]",
    "headline_length@headline",
    "metric_relevance@big_picture[3]",
    "metric_relevance@china_lens",
  ]);
  assert.ok(needsRepair(r));
});

test("월간 실제 출력 회귀: 주별 원 건수 비교·근거 없는 증감·통화 간 서열이 치명", () => {
  const { ctx, content, issues } = load("monthly");
  const r = validateWeekly(content, ctx, issues);
  assert.deepEqual(pick(r.fatal), ["change_unbacked@big_picture[3]", "cross_currency_rank@money", "volume_week_unadjusted@dek"]);
  assert.deepEqual(pick(r.warn), ["metric_relevance@china_lens"]);
});

test("trend_unbacked: refs 3개 미만이고 지표도 없는 큰 흐름은 치명, refs 3개 또는 지표 1개면 통과", () => {
  const { ctx, content } = load("weekly");
  const c = structuredClone(content);
  c.big_picture[0] = { ...c.big_picture[0], refs: ["S06", "S01"], metrics: [] };
  assert.ok(validateWeekly(c, ctx).fatal.some((f) => f.rule === "trend_unbacked" && f.path === "big_picture[0]"));
  c.big_picture[0] = { ...c.big_picture[0], refs: ["S06", "S01", "S09"], metrics: [] };
  assert.ok(!validateWeekly(c, ctx).fatal.some((f) => f.rule === "trend_unbacked"));
});

test("volume_wow_unadjusted: 지난주 대비 기사 수는 같은 요일 지표(vol.lfl*)로만", () => {
  // 실제 통과 사례: 주간 dek "기사 수는 지난주와 비슷했고" + vol.lfl_change
  const dek = "이번 주 중국 AI 보도는 앤트로픽의 기업공개(IPO) 준비와 대규모 자금 조달로 쏠렸다. 기사 수는 지난주와 비슷했고 응용 쪽 흐름은 엇갈렸다.";
  assert.equal(volumeWowUnadjusted(dek, ["vol.total", "vol.lfl_change"]), false);
  assert.equal(volumeWowUnadjusted("기사 수는 562건으로 지난주 568건보다 줄었다.", ["vol.total", "vol.prev_total"]), true);
  assert.equal(volumeWowUnadjusted("앤트로픽 언급은 지난주보다 늘었다.", ["ent.anthropic.chg"]), false); // 물량 이야기가 아님
});

test("change_unbacked: 월간 실제 문장 '사례가 크게 늘었다' + 증감 없는 지표 → 치명, 증감 지표가 있으면 통과", () => {
  const s = "AI가 수학 증명과 과학 연구에 참여하는 사례가 크게 늘었다.";
  assert.equal(changeUnbacked(s, ["term.递归自我改进", "term.超级智能"]), true);
  assert.equal(changeUnbacked("구현지능 언급이 지난주 59건에서 73건으로 늘었다.", ["term.具身智能.rise"]), false);
  assert.equal(changeUnbacked("언급 건수는 지난주보다 늘었다.", ["ent.anthropic.chg"]), false);
});

test("cross_currency_rank: 월간 실제 문장(300억 달러와 1000억 위안을 서열) → 치명", () => {
  const s = "10월 금액 중 가장 큰 것은 오픈AI 300억 달러, 앤트로픽 상장 관련 163억 달러와 2조 달러 베팅 보도였다. 딥시크는 1000억 위안 융자 소식이 여러 매체에 나왔다.";
  assert.equal(crossCurrencyRank(s), true);
  assert.equal(crossCurrencyRank("가장 큰 것은 메타 1,000억 달러 조달 추진이었다."), false); // 한 통화만
});

test("direction_conflict: 주간 실제 문장 — 智能体 84→52 를 인용하며 '열풍' (수리 대상 경고), 문장 단위로 본다", () => {
  const facts = { "term.智能体.fall": "智能体 84건→52건", "term.具身智能.rise": "具身智能 59건→73건", "term.人形机器人.fall": "人形机器人 11건→3건", "ent.meta.chg": "메타 -53%" };
  const s = "개인 에이전트 열풍과 수익화 고민 Meta의 개인 비서 Muse가 출시 두 달 만에 누적 다운로드 1,040만 건을 기록하자 중국 창업팀들이 개인 에이전트 제품에 뛰어들고 있다.";
  assert.deepEqual(directionConflicts(s, ["term.智能体.fall"], facts), ["term.智能体.fall=智能体 84건→52건 인데 상승 표현"]);
  // 오르는 용어와 내리는 용어를 서로 다른 문장에서 맞게 쓰면 통과 (W44 실제 생성본)
  const ok = "구현형 지능(具身智能) 언급이 73건으로 가장 많았다. 로봇 실증 기사가 늘었다. 반면 인간형 로봇(人形机器人) 언급은 줄었다.";
  assert.deepEqual(directionConflicts(ok, ["term.具身智能.rise", "term.人形机器人.fall"], facts), []);
});

test("metric_relevance: 인용한 지표의 대상(매체·기업)이 문장에 없으면 경고", () => {
  const names = new Map([["bytedance", "바이트댄스"], ["deepseek", "딥시크"]]);
  const s = "DeepSeek 신버전 V4.1-Flash-1017은 주간 호출량 33.6조 토큰으로 OpenRouter 1위에 올랐다.";
  assert.deepEqual(irrelevantMetrics(s, ["src.36Kr.chg"], names), ["src.36Kr.chg"]);
  assert.deepEqual(irrelevantMetrics(s, ["ent.deepseek"], names), []);
  assert.deepEqual(irrelevantMetrics("이 기업은 상장을 준비했다.", ["ent.bytedance.chg"], names, "bytedance"), []); // movers 주체
});

test("기간 표기(10월·11월 1일·W44)는 숫자 검사에서 뺀다", () => {
  assert.equal(stripPeriodLabels("10월 W44 에 11월 1일까지 562건").trim(), "에 까지 562건");
});

test("제목은 여유 없이 36자: 37자면 headline_length 경고", () => {
  const { ctx, content } = load("weekly");
  const c = { ...content, headline: "가".repeat(37) };
  assert.ok(validateWeekly(c, ctx).warn.some((w) => w.rule === "headline_length" && w.detail === "37/36자"));
  const ok = { ...content, headline: "가".repeat(36) };
  assert.ok(!validateWeekly(ok, ctx).warn.some((w) => w.rule === "headline_length"));
});

test("남은 치명 항목 삭제: china_lens 는 빼고, dek·headline 은 결정적 대체 대상으로 돌려준다", () => {
  const { ctx, content } = load("weekly");
  const r = validateWeekly(content, ctx);
  const d = dropFatalPeriodic(content, [...r.fatal, { level: "fatal", rule: "x", path: "dek", detail: "" }]);
  assert.equal(d.content.china_lens, null);
  assert.deepEqual(d.dropped, ["china_lens"]);
  assert.deepEqual(d.needsFallback, ["dek"]);
  assert.equal(d.content.big_picture.length, content.big_picture.length);
  assert.equal(validateWeekly(d.content, ctx).fatal.length, 0);
});
