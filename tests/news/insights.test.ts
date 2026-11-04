/** AI 인사이트 두 단계 — 저장 전 정리·검사 (src/lib/insights.ts) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanInsightItem, flagWeight, insightFlags, insightUserMessage, stripHanParens } from "../../src/lib/insights";

const src = {
  title_cn: "芯联动力完成C轮融资",
  summary_cn: "融资约20亿元",
  content_cn: "芯联动力完成约20亿元C轮融资，投后估值超20亿美元。碳化硅产品进入15、19层验证。座舱算力不足。",
};

test("괄호 속 한자 병기만 지우고 나머지는 그대로", () => {
  assert.equal(stripHanParens("차 안 스마트 시스템(座舱)의 칩과 (端侧) 처리"), "차 안 스마트 시스템의 칩과 처리");
  assert.equal(stripHanParens("가중치(모델 내부 설정값)"), "가중치(모델 내부 설정값)");
  const out = cleanInsightItem({ ai_insights_kr: "칩(座舱)", ai_insights_detail_kr: "자세히（端侧）", key_terms: [{ term: "座舱", explanation_kr: "공간(座舱)입니다" }] });
  assert.equal(out.ai_insights_kr, "칩");
  assert.equal(out.ai_insights_detail_kr, "자세히");
  assert.equal((out.key_terms as { term: string; explanation_kr: string }[])[0].explanation_kr, "공간입니다");
  assert.equal((out.key_terms as { term: string }[])[0].term, "座舱");
});

test("검사: 남은 한자·원문에 없는 숫자·붙여 쓴 숫자·용어·자세히 없음", () => {
  const flags = insightFlags(
    {
      ai_insights_kr: "芯联动力가 약 20억 위안을 받았고 기업가치는 30억 달러입니다.",
      ai_insights_detail_kr: "",
      key_terms: [{ term: "碳化硅", explanation_kr: "소재" }, { term: "SiC", explanation_kr: "약자" }, { term: "大模型", explanation_kr: "모델" }],
    },
    src,
    { expectDetail: true }
  );
  assert.deepEqual(flags.map((f) => f.kind).sort(), ["han", "missing_detail", "number", "term_not_chinese", "term_not_in_source"]);
  assert.deepEqual(flags.find((f) => f.kind === "number"), { kind: "number", field: "ai_insights_kr", value: "30" });

  const fmt = insightFlags({ ai_insights_kr: "검증 중입니다.", ai_insights_detail_kr: "제1,5층 부근에서 검증합니다." }, src);
  assert.deepEqual(fmt.map((f) => f.kind), ["number_format"]);
});

test("검사: 쉼표 숫자는 원문 표기와 비교, 한 자리 숫자는 보지 않음, 원문이 없으면 숫자·용어 검사 생략", () => {
  const ok = insightFlags({ ai_insights_kr: "1,055억 위안 중 1분기 3곳입니다.", ai_insights_detail_kr: "자세히" }, { content_cn: "规模1055亿元" });
  assert.deepEqual(ok, []);
  const noSrc = insightFlags({ ai_insights_kr: "999억", key_terms: [{ term: "SiC" }] }, {});
  assert.deepEqual(noSrc, []);
});

test("길이 초과와 무게", () => {
  const f = insightFlags({ ai_insights_kr: "가".repeat(221), ai_insights_detail_kr: "나".repeat(381) }, {});
  assert.deepEqual(f.map((x) => x.kind), ["length", "length"]);
  assert.equal(flagWeight(f), 2);
});

test("user 메시지는 n8n 과 같은 모양 (본문 3000자)", () => {
  const m = insightUserMessage({ title_cn: "T", summary_cn: "", summary_kr: "요약", content_cn: "가".repeat(3100) });
  assert.ok(m.startsWith("다음 뉴스를 분석하세요:\n\n제목: T\n요약: 요약\n본문: "));
  assert.equal(m.split("본문: ")[1].length, 3000);
});
