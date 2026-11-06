import { test } from "node:test";
import assert from "node:assert/strict";
import { GLOSSARY_COMPACT, GLOSSARY_PICK_JS, glossaryN8nExpr, glossaryPromptBlock } from "../../src/lib/text/ko-glossary";

test("번역 지시 사전 구간: 원문에 나온 항목만", () => {
  const b = glossaryPromptBlock("宇树科技第三季度营收增长，具身智能赛道升温");
  assert.match(b, /宇树\/宇树科技 = 유니트리 \(Unitree\) ✗ 유수과기/);
  assert.match(b, /具身智能\/物理AI\/物理人工智能 = 피지컬 AI/);
  assert.doesNotMatch(b, /센스타임/);
  assert.equal(glossaryPromptBlock("苹果发布新手机"), "");
});

test("n8n 식 안의 같은 함수는 저장소 함수와 결과가 같다 (Gate 2)", () => {
  // eslint-disable-next-line no-new-func
  const pick = new Function(`return (${GLOSSARY_PICK_JS});`)() as (g: unknown, t: string, m?: number) => string;
  for (const t of ["宇树科技第三季度营收增长，具身智能赛道升温", "月之暗面与智谱、美团、百度文心5.5", "没有命中", "智能体 算力 世界模型 大模型 端侧 出海 科创板"]) {
    assert.equal(pick(GLOSSARY_COMPACT, t), glossaryPromptBlock(t), t);
  }
  const expr = glossaryN8nExpr("$json.title_cn");
  assert.ok(!expr.includes("}}"));
  // 식을 그대로 돌려 본다 ($json 자리에 값)
  const run = new Function("$json", `return ${expr};`) as (j: { title_cn: string }) => string;
  assert.equal(run({ title_cn: "宇树" }), glossaryPromptBlock("宇树"));
});
