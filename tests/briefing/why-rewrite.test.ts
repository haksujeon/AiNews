import { test } from "node:test";
import assert from "node:assert/strict";
import { acceptableWhy, whyHasNumber, whySystemPrompt, whyUserMessage } from "../../src/lib/briefing/why-rewrite";
import { WHY_MAX } from "../../src/lib/briefing/validate";

test("whyHasNumber·acceptableWhy: 숫자·빈 문장·길이 초과는 받지 않는다", () => {
  assert.equal(whyHasNumber("매출이 367% 늘었다."), true);
  assert.equal(whyHasNumber("매출이 크게 늘었다."), false);
  for (const name of ["GLM-6를 공개했다.", "Qwen4를 붙였다.", "GPT Image 2.6이 앞섰다.", "Claude Haiku 5.5보다 싸다.", "H3 Image 를 공개"]) assert.equal(whyHasNumber(name), false, name);
  for (const n of ["로봇이 1만 대 나갔다.", "4주 만에 해냈다.", "2026년부터 판다.", "주가가 3배 올랐다."]) assert.equal(whyHasNumber(n), true, n);
  assert.equal(acceptableWhy("그래서 개발자는 직접 고쳐 쓸 수 있다."), true);
  assert.equal(acceptableWhy(""), false);
  assert.equal(acceptableWhy("가".repeat(WHY_MAX + 1)), false);
  assert.equal(acceptableWhy("3배 빨라졌다."), false);
  assert.equal(acceptableWhy(undefined), false);
});

test("whySystemPrompt·whyUserMessage: 규칙 19·20, 숫자 금지, avoid 안내 / 기사 본문은 clipBody 로", () => {
  const sys = whySystemPrompt();
  assert.match(sys, /숫자를 쓰지 않습니다/);
  assert.match(sys, /avoid/);
  assert.match(sys, new RegExp(`${WHY_MAX}자 이내`));
  const msg = JSON.parse(whyUserMessage([{ rank: 2, title: "t", what: "w", why: "old", avoid: ["x — y"], articles: [{ title_kr: "a", summary_kr: "s", content_kr: "본문" }] }]));
  assert.equal(msg.rank, 2);
  assert.equal(msg.why_old, "old");
  assert.deepEqual(msg.avoid, ["x — y"]);
  assert.equal(msg.ARTICLES[0].body_kr, "본문");
});
