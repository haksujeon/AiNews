import { test } from "node:test";
import assert from "node:assert/strict";
import { toEasyResult, easyFlags, easyShowable, type EasyResult } from "../../src/lib/easy-explain";
import { getEasyExplain } from "../../src/lib/news-utils";

const ok: EasyResult = {
  easy_kr: "AI가 실험을 대신 되풀이해 주는 이야기예요.",
  why_kr: "기사는 연구가 빨라질 수 있다고 봐요.",
  easy_en: "AI repeats experiments for people.",
  why_en: "The article says research could speed up.",
  easy_cn: "简单来说就是让AI反复做实验。",
  why_cn: "文章认为研究可能会变快。",
};

test("toEasyResult: 빈 필드가 있으면 null, 한국어·영어 괄호 속 한자는 지움", () => {
  assert.equal(toEasyResult({ ...ok, why_en: "" }), null);
  assert.equal(toEasyResult("x"), null);
  const r = toEasyResult({ ...ok, easy_kr: "차량 실내(座舱)를 쉽게 말하면" })!;
  assert.equal(r.easy_kr, "차량 실내를 쉽게 말하면");
  assert.equal(toEasyResult({ ...ok, easy_cn: "座舱(车内)" })!.easy_cn, "座舱(车内)");
});

test("toEasyResult: 한국어 칸만 표기 사전으로 고친다 (평터우거·평투거 → 펑터우거, Qwen 변형 → 큐원)", () => {
  const r = toEasyResult({ ...ok, easy_kr: "평투거는 알리바바의 칩 회사예요.", why_kr: "평터우거가 큐웬 모델용 칩을 만들어요.", easy_en: "T-Head makes chips." })!;
  assert.equal(r.easy_kr, "펑터우거는 알리바바의 칩 회사예요.");
  assert.equal(r.why_kr, "펑터우거가 큐원 모델용 칩을 만들어요.");
  assert.equal(r.easy_en, "T-Head makes chips.");
});

test("easyFlags: 한자·원문에 없는 숫자·풀이 없는 약어(AI 제외)", () => {
  const src = { title_cn: "实验", content_cn: "公司投入 200 亿元", summary_kr: "200억 위안 투입" };
  assert.deepEqual(easyFlags(ok, src), []);
  const f = easyFlags({ ...ok, easy_kr: "350억이 들었고 ETF 같은 상품, 実验" }, src);
  assert.ok(f.some((x) => x.kind === "number" && x.value === "350"));
  assert.ok(f.some((x) => x.kind === "abbr" && x.value === "ETF"));
  assert.ok(f.some((x) => x.kind === "han"));
  assert.ok(!easyFlags({ ...ok, easy_kr: "ETF(묶음 투자 상품)는 AI와 달라요" }, src).some((x) => x.kind === "abbr"));
});

test("easyShowable·getEasyExplain: 그 언어에 한자·숫자 깃발이 있으면 숨기고, 다른 언어로 채우지 않음", () => {
  const item = { ai_easy_kr: ok.easy_kr, ai_why_kr: ok.why_kr, ai_easy_en: ok.easy_en, ai_why_en: ok.why_en, ai_easy_cn: null, ai_why_cn: null, easy_flags: null };
  assert.deepEqual(getEasyExplain(item, "ko"), { easy: ok.easy_kr, why: ok.why_kr });
  assert.equal(getEasyExplain(item, "zh"), null);
  const flagged = { ...item, easy_flags: [{ kind: "number" as const, field: "why_kr" as const, value: "35" }] };
  assert.equal(getEasyExplain(flagged, "ko"), null);
  assert.ok(getEasyExplain(flagged, "en"));
  assert.equal(easyShowable([{ kind: "length", field: "easy_kr", length: 300 }], "kr"), true);
});
