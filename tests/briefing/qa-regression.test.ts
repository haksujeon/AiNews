/**
 * 2026-11-02 편집 QA 감사 회귀 시험 — 감사 JSON 이 오류로 판정한 실제 문장(그 판의 인용 기사 원문 포함)이
 * 지금 검증기에 잡히는지, 감사 수정안 문장은 통과하는지 본다. 실행: npm run test:unit
 * fixture: tests/briefing/fixtures/qa-2026-11-02.json (감사 대상 판의 문장 + 인용 기사 번역·중국어 요약)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  claimIssues,
  entityNotInOriginal,
  headlineTopIssue,
  isChinaSubject,
  leakedInstruction,
  moneyIssues,
  moneyRankIssue,
  outletClaimIssue,
  staleDateIn,
  staleEventIssues,
  type SourceDoc,
} from "../../src/lib/briefing/rules";
import { contextFromArticles, fitSentenceLengths, stripParentheticalHan, unsupportedEntities, normalizeContent, validateKo } from "../../src/lib/briefing/validate";
import { cvoConflict, rankIssues, uncitedDirectionConflicts, validateWeekly, normalizeWeekly } from "../../src/lib/briefing/periodic/validate";
import { buildStoryPool, moneyRowProblem } from "../../src/lib/briefing/periodic/prompt";
import { numericValues, checkTranslation } from "../../src/lib/briefing/translate";
import { reducedDaysFrom, type SourceDayCount } from "../../src/lib/metrics/period";
import { rankStories, type RankableArticle } from "../../src/lib/news-rank";
import type { CandidateArticle } from "../../src/lib/briefing/types";

interface Case {
  text: string;
  refs: string[];
  top?: { subject: string; title: string };
  editionDate?: string;
  term?: string;
}
type Art = { id: string; source_name: string; d: string; title_kr: string; title_cn: string; summary_kr: string; summary_cn: string; ai_insights_kr: string };
const FX = JSON.parse(readFileSync(join(__dirname, "fixtures", "qa-2026-11-02.json"), "utf8")) as { cases: Record<string, Case>; articles: Record<string, Art> };
const C = (k: string) => FX.cases[k];
const doc = (a: Art): SourceDoc => ({ ...a, insight_kr: a.ai_insights_kr, news_date: a.d });
const docsOf = (refs: string[]) => refs.map((r) => FX.articles[r]).filter(Boolean).map(doc);
const rules = (list: { rule: string }[]) => list.map((i) => i.rule);

// ───────────────────────── 데일리

test("10-27 sections[0]: '27B 경량 모델로 오픈소스 최고 성능' — 원문 '경량 모델 중 최고' 의 '중' 을 뺌 → qualifier_dropped, 수정안은 통과", () => {
  const c = C("d1027_section_qualifier");
  assert.ok(rules(claimIssues(c.text, docsOf(c.refs))).includes("qualifier_dropped"), c.text);
  assert.deepEqual(claimIssues("지위안 AREX-2, 27B 경량 모델 중 오픈소스 최고 성능", docsOf(c.refs)), []);
});

test("10-27 companies[0]: '역대 최대 규모 IPO' — 원문은 '중 하나가 될 전망'·'예고'·'도전' → qualifier_dropped, '예상되는' 은 통과", () => {
  const c = C("d1027_company_hedge");
  const got = claimIssues(c.text, docsOf(c.refs));
  assert.ok(got.some((i) => i.rule === "qualifier_dropped" && /최대|역대/.test(i.detail)), JSON.stringify(got));
  assert.deepEqual(claimIssues("Anthropic 역대 최대 규모가 예상되는 IPO와 대규모 컴퓨팅 약정", docsOf(c.refs)), []);
});

test("10-27·10-30·09-16 헤드라인이 1위 기사의 주체를 다루지 않음 → headline_not_top_story", () => {
  for (const k of ["d1027_headline_top", "d1030_headline_top", "d0916_headline_top"]) {
    const c = C(k);
    assert.equal(headlineTopIssue(c.text, c.top)?.rule, "headline_not_top_story", `${k}: ${c.text}`);
  }
  // 감사 수정안 (10-27: 바이두 1위면 바이두 헤드라인, 10-30: Anthropic 1위)
  assert.equal(headlineTopIssue("바이두 문심 OCR 2 오픈소스, Anthropic 상장 신청", C("d1027_headline_top").top), null);
  assert.equal(headlineTopIssue("알파벳 상장 후 최대 낙폭, Anthropic 첫 영업흑자", C("d1030_headline_top").top), null);
  assert.equal(headlineTopIssue("DeepSeek 1GW 데이터센터·바이트댄스 팀 에이전트", C("d0916_headline_top").top), null);
});

test("10-28 헤드라인 'OpenAI 나비에-스토크스 증명·Genie 4 공개' — 증명 공개는 9월 8일 → stale_event, 시점을 밝히면 통과", () => {
  const c = C("d1028_headline_stale");
  const got = staleEventIssues(c.text, docsOf(c.refs), c.editionDate);
  assert.ok(got.some((i) => i.rule === "stale_event" && /openai/.test(i.detail) && /2026-09-08/.test(i.detail)), JSON.stringify(got));
  assert.deepEqual(staleEventIssues("구글 Genie 4 공개, OpenAI 증명은 7주 만에 검증 착수", docsOf(c.refs), c.editionDate), []);
  assert.deepEqual(staleEventIssues("OpenAI가 9월 공개한 나비에-스토크스 증명을 전문가들이 7주 만에 파악했다.", docsOf(c.refs), c.editionDate), []);
  // 같은 날 사건(구글 Genie 4 공개)만 쓰면 통과
  assert.deepEqual(staleEventIssues("구글, 차세대 월드 모델 Genie 4 공개", docsOf(c.refs), c.editionDate), []);
});

test("staleDateIn: 달만 있는 날짜는 그 달 말일로 본다 (09-16 판의 '2026년 9월' 은 예전 사건이 아님), 2025년은 예전", () => {
  assert.equal(staleDateIn("2026년 9월, 아모데이는 감속을 촉구했다", "2026-09-16"), null);
  assert.equal(staleDateIn("OpenAI는 9월 8일 증명을 공개했다", "2026-10-28"), "2026-09-08");
  assert.ok(staleDateIn("2025년 10월 출시한 PolyBuzz", "2026-10-30"));
  assert.equal(staleDateIn("10월 26일 제출한 S-1", "2026-10-30"), null);
});

test("10-30 lede: '알파벳 … 시가총액 증발' 의 알파벳이 lede_refs 근거에 없음 → unsupported_entity (알파벳 = google 별칭 추가)", () => {
  const c = C("d1030_lede_alphabet");
  const arts = Object.values(FX.articles).map((a) => ({ ...a, news_date: a.d, category: "ai-biz", source_url: null, key_terms: [] })) as unknown as CandidateArticle[];
  const ctx = contextFromArticles(arts, "normal", new Set(), "2026-10-30");
  assert.ok(unsupportedEntities(c.text, c.refs, ctx).includes("google"), c.text);
});

test("10-31 companies[1]: 'DeepSeek … 에이전트 인프라 경쟁 주도' — 원문에 '주도' 없음 → trend_unsupported", () => {
  const c = C("d1031_company_trend");
  assert.ok(rules(claimIssues(c.text, docsOf(c.refs))).includes("trend_unsupported"), c.text);
  assert.deepEqual(claimIssues("DeepSeek Super-agent 설계와 원형을 오픈소스로 공개", docsOf(c.refs)), []);
});

test("07-15 top_stories[2].what: 수리 지시문 \"(…阶跃星辰 표기 대신 '스텝스타')\" 누출 → leaked_instruction", () => {
  const c = C("d0715_leak");
  assert.equal(leakedInstruction(c.text)?.rule, "leaked_instruction");
  assert.equal(leakedInstruction("스텝스타가 자사가 세계 최초라고 밝힌 에이전트 네이티브 운영체제 Step AOS를 발표했다."), null);
  // 괄호 병기 한자만은 결정적으로 지운다 (괄호 안에 한글이 섞이면 지우지 않고 검증기가 잡게 둔다)
  const content = normalizeContent({ headline: "h", lede: "스텝스타(阶跃星辰)가 STEPX 를 발표했다.", top_stories: [{ title: "t", what: c.text }] }).content;
  const cleaned = stripParentheticalHan(content);
  assert.equal(cleaned.lede, "스텝스타가 STEPX 를 발표했다.");
  assert.ok(cleaned.top_stories[0].what.includes("阶跃星辰"));
});

test("09-16 lede: 'OpenAI가 … Anthropic을 처음으로 넘어섰다' — 원문 'OpenRouter 데이터에 따르면 … 플랫폼에서' 범위 삭제 → qualifier_dropped", () => {
  const c = C("d0916_lede_scope");
  const got = claimIssues(c.text, docsOf(c.refs));
  assert.ok(got.some((i) => i.rule === "qualifier_dropped" && /OpenRouter/.test(i.detail)), JSON.stringify(got));
  const fixed = "해외에서는 OpenRouter에서 OpenAI 모델의 지출이 Anthropic을 처음 넘어섰다.";
  assert.ok(!claimIssues(fixed, docsOf(c.refs)).some((i) => /OpenRouter/.test(i.detail)));
});

test("04-14 sections[1]: '화웨이와 샤오미·아너' — 원문 荣耀·小米 (title_kr 오역 전파) → entity_not_in_original", () => {
  const c = C("d0414_section_original");
  assert.ok(entityNotInOriginal(c.text, docsOf(c.refs)).some((i) => /huawei/.test(i.detail)), c.text);
  assert.deepEqual(entityNotInOriginal("아너·샤오미 등 스마트폰 제조사들, 인간형 로봇 개발 경쟁", docsOf(c.refs)), []);
});

test("isChinaSubject: 이름표에 없는 중국 기업은 LLM 표시를 믿고, 해외 실체로만 된 주체는 믿지 않는다", () => {
  assert.equal(isChinaSubject({ subject: "쉰처", title: "'토큰 1호주' 쉰처 주가 급등", subject_is_chinese: true }), true);
  assert.equal(isChinaSubject({ subject: "Diffusion Intelligence", title: "확산 모델 스타트업 투자 유치", subject_is_chinese: true }), true);
  assert.equal(isChinaSubject({ subject: "OpenAI", title: "OpenAI, 나비에-스토크스 증명", subject_is_chinese: true }), false);
  assert.equal(isChinaSubject({ subject: "목시", title: "목시, 1~3분기 흑자 전환", subject_is_chinese: false }), true); // 이름표 추가 (沐曦)
  assert.equal(isChinaSubject({ title: "중국 월드모델 투자", text: "바이트댄스 인턴 출신 창업" }), true);
});

test("매체 수 주장: '두 매체가 전했다' 인데 근거 매체 1곳 → outlet_count", () => {
  assert.equal(outletClaimIssue("약 3000만 달러를 투자받았다고 두 매체가 전했다.", ["36Kr", "36Kr", "36Kr"])?.rule, "outlet_count");
  assert.equal(outletClaimIssue("두 매체가 전했다.", ["36Kr", "Huxiu"]), null);
});

// ───────────────────────── 주간·월간

const W44_FACTS = {
  "term.智能体.fall": "智能体 84건→55건",
  "term.具身智能.rise": "具身智能 59건→73건",
  "term.算力.rise": "算力 38건→55건",
  "cvo.china": "중국 실체가 나온 기사 30.7%",
  "cvo.foreign": "해외 실체가 나온 기사 51.1%",
};

test("W44 dek·big_picture: '구현형 AI와 에이전트 용어의 언급이 함께 늘었다' — 智能体 84→55 를 인용하지 않아도 → direction_conflict", () => {
  const dek = "구현형 AI와 에이전트 용어의 언급이 함께 늘었다.";
  assert.deepEqual(uncitedDirectionConflicts(dek, W44_FACTS), ["term.智能体.fall=智能体 84건→55건 인데 상승 표현"]);
  // 실제 W44 dek 전문도 잡힌다
  assert.ok(uncitedDirectionConflicts(C("w44_dek_direction").text, W44_FACTS).length >= 1, C("w44_dek_direction").text);
  // 감사 수정안: 구현형 AI 는 늘고 에이전트는 줄었다
  assert.deepEqual(uncitedDirectionConflicts("구현형 AI 용어 언급은 59건→73건으로 늘었지만, 에이전트 용어는 84건→55건으로 줄었다.", W44_FACTS), []);
});

test("W44 term.why '이번 주 용어 언급이 가장 많이 늘었다' (具身智能 +14, 실제 1위는 算力 +17) → rank_mismatch", () => {
  const c = C("w44_term_rank");
  const ranks = { entities: ["anthropic"], terms: ["具身智能", "智能体"], rising: ["算力", "自由现金流", "具身智能"], falling: ["智能体"] };
  assert.deepEqual(rules(rankIssues(c.text, { ranks }, c.term)), ["rank_mismatch"]);
  assert.deepEqual(rankIssues("구현형 AI 용어 언급이 59건에서 73건으로 늘었다.", { ranks }, c.term), []);
  assert.deepEqual(rankIssues("算力 언급이 가장 많이 늘었다.", { ranks }), []);
  // 결정적 대체 제목("○○ 언급 최다")은 1위 기업이면 통과
  assert.deepEqual(rankIssues("이번 주 중국 AI 보도, 앤트로픽 언급 최다", { ranks }), []);
  assert.deepEqual(rules(rankIssues("이번 주 중국 AI 보도, 오픈AI 언급 최다", { ranks })), ["rank_mismatch"]);
});

test("W44 money: '앤트로픽은 163억 달러 확보' (상반기 매출·狂揽163亿美元) → money_not_deal, '상대적으로 작았다' → money_rank", () => {
  const c = C("w44_money");
  const docs = docsOf(c.refs);
  const got = moneyIssues(c.text, docs);
  assert.ok(got.some((i) => i.rule === "money_not_deal" && /163억 달러/.test(i.detail)), JSON.stringify(got));
  assert.equal(moneyRankIssue(c.text)?.rule, "money_rank");
  assert.equal(moneyRankIssue("중국에서는 딥시크의 약 1000억 위안 신규 융자와 초연지능 4억 위안 유치가 보도됐다."), null);
});

test("월간 money: '오픈AI 주도 인수합병 최대 110억 달러' — 원문 最大一笔110亿 (위안) → currency_mismatch, '이번 달 최대 거래' → money_rank", () => {
  const c = C("m10_money");
  const got = moneyIssues(c.text, docsOf(c.refs));
  assert.ok(got.some((i) => i.rule === "currency_mismatch" && /110억 달러/.test(i.detail)), JSON.stringify(got));
  assert.ok(got.some((i) => i.rule === "money_not_deal" && /163억 달러/.test(i.detail)), JSON.stringify(got));
  assert.equal(moneyRankIssue(c.text)?.rule, "money_rank");
  // 같은 기사의 아마존 70억 달러(약 500亿)는 통화가 맞아 통과
  assert.ok(!got.some((i) => /70억 달러/.test(i.detail)), JSON.stringify(got));
});

test("MONEY 표 행 분류 (프롬프트 MONEY 목록): 매출 행·통화 불일치 행은 빼고 거래 행만", () => {
  const m = C("m10_money");
  const byTitle = (t: RegExp) => Object.values(FX.articles).find((a) => t.test(a.title_kr))!;
  const ma = byTitle(/인수합병 195건/);
  const ant = byTitle(/163억 달러 확보/);
  const spacex = byTitle(/400억 달러 부채/);
  const row = (a: Art, amount: string) => ({ id: a.id, day: a.d, source: a.source_name, kind: "기타", amount, title_kr: a.title_kr, entities: [] });
  assert.equal(moneyRowProblem(row(ma, "110억 달러"), [doc(ma)]), "currency");
  assert.equal(moneyRowProblem(row(ant, "163억 달러"), [doc(ant)]), "value");
  assert.equal(moneyRowProblem(row(spacex, "400억 달러"), [doc(spacex)]), null);
  void m;
});

test("W44 big_picture[0] '상반기 매출 162억 달러' — 원문 162억 9,000만 달러 → amount_not_in_source", () => {
  const c = C("w44_bp0_amount");
  const got = moneyIssues(c.text, docsOf(c.refs));
  assert.ok(got.some((i) => i.rule === "amount_not_in_source" && /162억 달러/.test(i.detail)), JSON.stringify(got));
  assert.ok(!moneyIssues("상반기 매출 162억 9,000만 달러", docsOf(c.refs)).some((i) => i.rule === "amount_not_in_source"));
});

test("W44 헤드라인 'AI 자본 경쟁 가열'·월간 dek '돈의 흐름이 기사 주류' — 근거에 없는 추세 단정 → trend_unsupported", () => {
  const h = C("w44_headline_trend");
  assert.ok(claimIssues(h.text, docsOf(h.refs)).some((i) => i.rule === "trend_unsupported" && /가열/.test(i.detail)));
  const d = C("m10_dek_trend");
  assert.ok(claimIssues(d.text, docsOf(d.refs)).some((i) => i.rule === "trend_unsupported" && /주류/.test(i.detail)));
});

test("W41 china_lens '국내 기업 소식을 주로 다뤘다' — cvo 중국 30.7% < 해외 51.1% → cvo_conflict", () => {
  assert.match(cvoConflict(C("w41_china_lens").text, W44_FACTS) ?? "", /30\.7% < 해외 51\.1%/);
  assert.equal(cvoConflict("중국 실체가 나온 기사는 30.7%, 해외 실체가 나온 기사는 51.1%로 해외 기업 소식 비중이 컸다.", W44_FACTS), null);
});

test("주간 china_centric: 흐름 4개 중 중국 주체 1개면 치명 (예전 경고)", () => {
  const c = normalizeWeekly({
    headline: "이번 주 AI",
    dek: "요약.",
    dek_refs: ["S1"],
    big_picture: [
      { title: "앤트로픽 상장", text: "앤트로픽이 상장을 준비했다.", refs: ["S1", "S1", "S1"], metrics: [] },
      { title: "오픈AI 조달", text: "오픈AI가 조달을 추진했다.", refs: ["S1", "S1", "S1"], metrics: [] },
      { title: "구글 모델", text: "구글이 모델을 냈다.", refs: ["S1", "S1", "S1"], metrics: [] },
      { title: "딥시크 융자", text: "딥시크가 융자를 받았다.", refs: ["S1", "S1", "S1"], metrics: [] },
    ],
  }).content;
  const ctx = { kind: "weekly" as const, sourceText: new Map([["S1", "앤트로픽 오픈AI 구글 딥시크 상장 조달 모델 융자"]]), facts: {}, entityNames: new Map(), terms: new Set<string>(), headlineMax: 36 };
  assert.ok(validateWeekly(c, ctx).fatal.some((f) => f.rule === "china_centric"));
});

test("주간 후보: 같은 사건을 다른 날·다른 글로 다룬 묶음은 사건 하나로 (2단계 묶기 재사용)", () => {
  const st = (id: string, title: string, src: string, day: string) => ({
    ids: [id], primary_id: id, title_kr: title, title_cn: "", summary_kr: "", sources: [src], days: [day], entities: ["deepseek"], score: 5,
  });
  const pool = buildStoryPool(
    [st("a", "딥시크 Super-agent 오픈소스 공개", "36Kr", "2026-10-30"), st("b", "딥시크 Super-agent 구조 분석", "Qbitai", "2026-10-31"), st("c", "딥시크 신규 융자 1000억 위안", "Huxiu", "2026-10-26")],
    []
  );
  assert.equal(pool.length, 2);
  const sa = pool.find((p) => p.ids.includes("a"))!;
  assert.deepEqual([...sa.ids].sort(), ["a", "b"]);
  assert.deepEqual([...sa.sources].sort(), ["36Kr", "Qbitai"]);
});

// ───────────────────────── 번역·수집 품질·선정

test("번역 숫자 검사: 범위 '7~10%' 와 '7%至10%'·'7-10%'·'7% to 10%' 는 같은 값 (10-29 zh 오탐)", () => {
  const ko = numericValues("매출 성장률 7~10%");
  assert.deepEqual([...numericValues("营收增长7%至10%")], [...ko]);
  assert.deepEqual([...numericValues("revenue growth of 7-10%")], [...ko]);
  assert.deepEqual([...numericValues("7% to 10% growth")], [...ko]);
  assert.deepEqual([...numericValues("5~7억 위안")], [...numericValues("5亿至7亿元")]);
  const base = normalizeContent({ headline: "h", lede: "l", top_stories: [{ title: "t", what: "가격을 7~10% 올렸다.", why: "y" }] }).content;
  const zh = structuredClone(base);
  zh.headline = "标题"; zh.lede = "导语"; zh.top_stories[0].title = "题"; zh.top_stories[0].why = "因";
  zh.top_stories[0].what = "价格上调7%至10%。";
  assert.ok(!checkTranslation(base, zh, "zh").some((p) => p.includes("top_stories[0].what")), checkTranslation(base, zh, "zh").join("\n"));
});

function series(days: string[], f: (d: string) => Record<string, number>): SourceDayCount[] {
  return days.flatMap((d) => Object.entries(f(d)).map(([source, count]) => ({ date: d, source, count })));
}
const range = (a: string, b: string) => {
  const out: string[] = [];
  for (let t = Date.parse(`${a}T00:00:00Z`); t <= Date.parse(`${b}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};
const wkend = (d: string) => [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());
// 수집 완전 구간(10-13~): 36Kr 평일 50·주말 10, ITHome 4
const complete = series(range("2026-10-13", "2026-11-01"), (d) => ({ "36Kr": wkend(d) ? 10 : 50, ITHome: 4, Huxiu: 25 }));

test("데이터 알림: 축소 수집 판정은 매체별 실제 건수 — 04-14(36Kr 16 > 상한 12)는 아님, 07-15·10월 초 보충 수집은 축소", () => {
  // 4월 원 수집: 36Kr 하루 15~25건 (상한 12 를 자주 넘음)
  const april = series(range("2026-03-31", "2026-04-28"), (d) => ({ "36Kr": wkend(d) ? 6 : d === "2026-04-08" ? 23 : 16, ITHome: wkend(d) ? 6 : 3, Qbitai: 6 }));
  const r1 = reducedDaysFrom([...april, ...complete], ["2026-04-14", "2026-04-12"]);
  assert.equal(r1.has("2026-04-14"), false);
  assert.equal(r1.has("2026-04-12"), false); // 일요일 36Kr 6·ITHome 6 이지만 그 구간은 상한이 걸린 적 없음
  // 7월 보충 수집: 36Kr ≤ 12, ITHome ≤ 6 이 계속
  const july = series(range("2026-07-01", "2026-07-29"), () => ({ "36Kr": 12, ITHome: 6, Qbitai: 9 }));
  assert.equal(reducedDaysFrom([...july, ...complete], ["2026-07-15"]).has("2026-07-15"), true);
  // 10월 초: 10-03(토) 36Kr 7 도 상한 구간이라 축소
  const oct = series(range("2026-09-20", "2026-10-12"), (d) => ({ "36Kr": d === "2026-10-03" ? 7 : 12, ITHome: 6 }));
  const r3 = reducedDaysFrom([...oct, ...complete], ["2026-10-03", "2026-10-12"]);
  assert.ok(r3.has("2026-10-03") && r3.has("2026-10-12"));
  // 수집 완전 구간의 주말(10-17, 36Kr 10)은 축소 수집이 아니다 (부분 수집 판정은 별도)
  assert.equal(reducedDaysFrom(complete, ["2026-10-17"]).has("2026-10-17"), false);
});

test("선정 가중: 사건 단위 매체 수는 사건의 대표 묶음에만 가산, 한 매체 해외 논문은 감점", () => {
  const a = (id: string, title_kr: string, src: string, title_cn: string, cat = "ai-tech"): RankableArticle => ({ id, source_name: src, category: cat, title_kr, title_cn, summary_kr: "" });
  const day = [
    a("s1", "Anthropic, S-1 투자설명서 공개", "36Kr", "Anthropic公开招股书S-1"),
    a("s2", "Anthropic S-1 심층 분석", "Huxiu", "Anthropic招股书S-1深度解读"),
    a("s3", "Anthropic S-1, 첫 영업이익", "Synced", "Anthropic S-1首次盈利"),
    a("p1", "MS 연구팀, 진단 에이전트 논문 공개", "36Kr", "微软研究团队发布诊断论文"),
    a("c1", "딥시크, 신규 라운드 1000억 위안", "36Kr", "DeepSeek新一轮融资1000亿"),
  ];
  const st = rankStories(day);
  const ant = st.filter((x) => ["s1", "s2", "s3"].includes(x.primary.id));
  assert.equal(ant.filter((x) => x.scoreDetail.cross_coverage > 0).length, 1);
  assert.equal(ant[0].eventSources.length, 3);
  assert.equal(st.find((x) => x.primary.id === "p1")!.scoreDetail.foreign_paper, -1.5);
  assert.equal(st.find((x) => x.primary.id === "c1")!.scoreDetail.cn_deal, 0.5);
});

test("여러 문장 필드 길이: 넘친 끝 문장만 통째로 뺀다 (10-28 what 175/160 — 감사 수정안 '마지막 문장 삭제'), 한 문장은 그대로", () => {
  const long = "가".repeat(100) + "였다. " + "나".repeat(50) + "였다. " + "다".repeat(20) + "였다.";
  const c = normalizeContent({ headline: "h", lede: "l", top_stories: [{ title: "t", what: long, why: "라".repeat(130) }] }).content;
  const { content, trimmed } = fitSentenceLengths(c);
  assert.ok(content.top_stories[0].what.length <= 160);
  assert.ok(content.top_stories[0].what.endsWith("였다."));
  assert.equal(content.top_stories[0].why.length, 130); // 한 문장은 자르지 않는다 (검증기가 치명으로 잡아 수리)
  assert.deepEqual(trimmed, ["top_stories[0].what"]);
});

test("헤드라인 대체: 수리 뒤에도 헤드라인만 치명이면 1위 기사 제목(32자 이내)으로 — 10-27 재생성 35/32자", async () => {
  const { headlineFallback } = await import("../../src/lib/briefing/generate");
  const c = normalizeContent({ headline: "Anthropic 상장 신고, 매출 13배와 807억 달러 손실", lede: "l", top_stories: [{ title: "Anthropic, 나스닥 상장 위한 투자설명서 공개", what: "w" }] }).content;
  const r = { fatal: [{ level: "fatal" as const, rule: "headline_length", path: "headline", detail: "35/32자" }], warn: [], droppedRefs: [], stats: { numbersChecked: 0, topStories: 1, chinaCentric: 0, citedIds: 0, bodyChars: 0 } };
  assert.equal(headlineFallback(c, r)?.headline, "Anthropic, 나스닥 상장 위한 투자설명서 공개");
  assert.equal(headlineFallback(c, { ...r, fatal: [] }), null);
});

test("주간 한자 정리: W44 big_picture 의 '구현형 AI(具身智能)와 智能体' → 괄호 병기 삭제·지표 용어 한국어 표기", async () => {
  const { glossPeriodicHan } = await import("../../src/lib/briefing/periodic/generate");
  const c = normalizeWeekly({ headline: "h", dek: "d", big_picture: [{ title: "t", text: "구현형 AI(具身智能)와 智能体 등 용어 언급이 늘었다." }], term: { term: "智能体", why: "智能体 언급" } }).content;
  const g = glossPeriodicHan(c);
  assert.equal(g.big_picture[0].text, "피지컬 AI와 에이전트 등 용어 언급이 늘었다.");
  assert.equal(g.term!.term, "智能体"); // 용어 칸 원어는 그대로
  assert.equal(g.term!.why, "에이전트 언급");
});

test("숫자+단위 오탐: 'Genie 2, 대화형'·'86 대규모' 는 숫자+단위가 아니다 (10-28·10-31 재생성 실패 원인), '2위' 는 그대로 잡는다", () => {
  const arts = [{ id: "a", source_name: "36Kr", source_url: null, category: "ai-tech", title_cn: "", title_kr: "Genie 2 대화형 세계 모델", summary_kr: "로봇 86대가 대규모 학습", ai_insights_kr: "", key_terms: [] }] as CandidateArticle[];
  const ctx = contextFromArticles(arts, "short");
  const c = normalizeContent({
    headline: "Genie 2 공개",
    lede: "Genie 2, 대화형 모델이다. 로봇 86 대규모 학습.",
    lede_refs: ["a"],
    top_stories: [{ title: "구글 Genie 2, 대화형 세계 모델", what: "로봇 86 대규모 학습을 했다.", why: "2위를 했다.", refs: ["a"], subject: "구글" }],
  }).content;
  const fatal = validateKo(c, ctx).report.fatal.filter((f) => f.rule === "number_unit_not_in_source");
  assert.deepEqual(fatal.map((f) => f.path), ["top_stories[0].why"], JSON.stringify(fatal));
});

test("범위 토큰: '일반 GPU에서 구동' 의 GPU 는 플랫폼 범위가 아니다 (10-27 재생성 오탐)", () => {
  const docs: SourceDoc[] = [{ title_kr: "", title_cn: "", summary_kr: "장문서 벤치마크 1위를 기록했으며, 일반 GPU에서도 구동할 수 있다.", insight_kr: "" }];
  assert.ok(!claimIssues("바이두 OCR 2, 장문서 벤치마크 1위", docs).some((i) => /GPU/.test(i.detail)));
});
