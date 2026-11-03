import { test } from "node:test";
import assert from "node:assert/strict";
import { coMentions, pickWindowEnd, shareChangePct } from "../../src/lib/companies";
import { companyName, companyDirectory, isCompanyKey } from "../../src/lib/company-names";
import { ENTITIES } from "../../src/lib/briefing/entities";

const art = (title_kr: string) => ({ title_kr, title_cn: "", summary_kr: "" });

test("함께 언급: 같은 기사에 같이 나온 횟수, 기사당 1회, 자기 자신 제외", () => {
  const { co, base } = coMentions([art("딥시크와 텐센트 협력, 딥시크 또"), art("딥시크·텐센트·오픈AI"), art("오픈AI 단독")]);
  assert.equal(base.deepseek, 2);
  assert.equal(base.openai, 2);
  assert.deepEqual(co.deepseek, [{ key: "tencent", n: 2 }, { key: "openai", n: 1 }]);
  assert.ok(!co.deepseek.some((r) => r.key === "deepseek"));
  assert.equal(co.openai.find((r) => r.key === "tencent")?.n, 1);
});

test("비중 증감: 구간 기사 수가 달라도 100건당 비중으로 비교, 건수가 적으면 null", () => {
  // 20/400 = 5%, 10/100 = 10% → -50%
  assert.equal(shareChangePct(20, 400, 10, 100), -50);
  assert.equal(shareChangePct(4, 400, 10, 100), null);
  assert.equal(shareChangePct(20, 0, 10, 100), null);
});

test("비교 구간 끝: 마지막 날이 수집 미완(진행 중)이면 전날", () => {
  assert.equal(pickWindowEnd("2026-11-03", true), "2026-11-02");
  assert.equal(pickWindowEnd("2026-11-03", false), "2026-11-03");
});

test("기업 이름: 54곳 × 3개 언어 모두 비어 있지 않고 키·사람·제품 이름이 아니다", () => {
  assert.equal(companyDirectory().length, ENTITIES.length);
  const bad = ["저커버그", "Muse Wonder", "扎克伯格", "량원펑", "梁文锋"];
  for (const e of ENTITIES)
    for (const l of ["ko", "en", "zh"]) {
      const n = companyName(e.key, l);
      assert.ok(n && n !== e.key, `${e.key}/${l} 이름 없음`);
      assert.ok(!bad.includes(n), `${e.key}/${l} = ${n}`);
    }
  assert.equal(companyName("meta", "ko"), "메타");
  assert.equal(companyName("cn_gov", "ko"), "중국 정부·기관");
  assert.equal(companyName("deepseek", "en"), "DeepSeek");
});

test("기업 키: 이름표에 있는 키만", () => {
  assert.ok(isCompanyKey("deepseek"));
  assert.ok(!isCompanyKey("nope"));
  assert.ok(!isCompanyKey("__proto__"));
});
