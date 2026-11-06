import { test } from "node:test";
import assert from "node:assert/strict";
import { HAN_RE, HANGUL_RE, applyHanGlossary, classifyHan, hanResidue, hasHan } from "../../src/lib/text/han";
import { HAN_GLOSSARY } from "../../src/lib/text/han-glossary";
import * as validate from "../../src/lib/briefing/validate";

test("菲尔兹상: 짧은 한자 덩어리는 사전으로 결정적 치환 (2단계)", () => {
  const c = classifyHan("그는 菲尔兹상 수상자다.", HAN_GLOSSARY);
  assert.equal(c.stage, 2);
  assert.deepEqual(c.tokens, ["菲尔兹"]);
  assert.equal(c.fixed, "그는 필즈상 수상자다.");
  assert.deepEqual(c.replaced, [["菲尔兹", "필즈"]]);
});

test("괄호 병기는 허용 (1단계, 고치지 않음)", () => {
  const text = "창업자 량원펑(梁文锋)은 베이징에서, 위첸(于谦)·린쥔양(林俊旸, 32세)도 언급했다.";
  assert.deepEqual(hanResidue(text).tokens, []);
  assert.equal(hanResidue(text).ratio, 0);
  assert.equal(classifyHan(text, HAN_GLOSSARY).stage, 1);
  // 브리핑 검증처럼 괄호도 잡게 하면 잡힌다
  assert.deepEqual(hanResidue(text, { allowParenthetical: false }).tokens, ["梁文锋", "于谦", "林俊旸"]);
  // 전각 괄호도 같다
  assert.deepEqual(hanResidue("유니트리（宇树科技）가 상장한다").tokens, []);
});

test("문장 전체 중국어는 3단계 (LLM 재번역 대상), 그 문장을 돌려준다", () => {
  const text = "AI 도입으로 업무가 빨라졌다. 效率性和有效性得到提升。다음 분기 계획은 미정이다.";
  const r = hanResidue(text);
  assert.deepEqual(r.tokens, ["效率性和有效性得到提升"]);
  assert.deepEqual(r.sentences, ["效率性和有效性得到提升。"]);
  assert.ok(r.ratio > 0.2 && r.ratio < 0.5, String(r.ratio));
  assert.equal(classifyHan(text, HAN_GLOSSARY).stage, 3);
});

test("숫자·라틴 문자와 붙은 한자: 숫자는 한자로 세지 않고, 사전 키와 정확히 같은 덩어리만 바꾼다", () => {
  assert.deepEqual(hanResidue("알리바바가 千问3.7 시리즈를 공개").tokens, ["千问"]);
  assert.equal(applyHanGlossary("알리바바가 千问3.7 시리즈를 공개", HAN_GLOSSARY).text, "알리바바가 큐원3.7 시리즈를 공개");
  // "2300颗星星" 은 사전에 없음 → 3단계
  const c = classifyHan("Github에서 2300颗星星을 받았다", HAN_GLOSSARY);
  assert.equal(c.stage, 3);
  assert.deepEqual(c.tokens, ["颗星星"]);
  // 덩어리 일부만 사전과 같으면(华为云) 바꾸지 않는다
  assert.equal(classifyHan("华为云 매출", HAN_GLOSSARY).stage, 3);
  assert.equal(classifyHan("华为云 매출", HAN_GLOSSARY).fixed, "华为云 매출");
  // 5자 이상은 사전에 있어도 2단계가 아니다
  assert.equal(applyHanGlossary("中国科学院", new Map([["中国科学院", "중국과학원"]])).replaced.length, 0);
});

test("치환 뒤 조사를 새 낱말 받침에 맞춘다 (은/는·이/가·을/를·과/와·으로/로)", () => {
  const g = (t: string) => applyHanGlossary(t, HAN_GLOSSARY).text;
  assert.equal(g("科大讯飞가 발표"), "아이플라이텍이 발표");
  assert.equal(g("千问는 새 모델"), "큐원은 새 모델");
  assert.equal(g("千问를 공개"), "큐원을 공개");
  assert.equal(g("千问와 경쟁"), "큐원과 경쟁");
  assert.equal(g("千问로 전환"), "큐원으로 전환");
  assert.equal(g("豆包은 무료"), "더우바오는 무료"); // 받침 없음
  assert.equal(g("豆包으로 전환"), "더우바오로 전환");
  assert.equal(g("台积电이 증설"), "TSMC가 증설"); // 라틴 끝 = 받침 없음으로 봄
  assert.equal(g("千问."), "큐원.");
  // 조사가 아니라 낱말 첫 글자면 그대로 (가격·이다·이용)
  assert.equal(g("千问가격 인상"), "큐원가격 인상");
  assert.equal(g("千问이다"), "큐원이다");
  assert.equal(g("豆包이용자"), "더우바오이용자");
  // 연달아 나와도 위치가 어긋나지 않는다
  assert.equal(g("千问는英伟达가"), "큐원은엔비디아가");
});

test("사전 치환 + 남은 덩어리 → 3단계, fixed 에는 치환이 먼저 반영", () => {
  const c = classifyHan("英伟达와 마화滕이 만났다", HAN_GLOSSARY);
  assert.equal(c.stage, 3);
  assert.equal(c.fixed, "엔비디아와 마화滕이 만났다");
});

test("한자 없음 → 0단계, 한글은 한자가 아니다 (호환 한자 U+F900 범위 확인)", () => {
  assert.equal(classifyHan("테슬라, 왜 빅히트 관계자를 잡을 수 없나?", HAN_GLOSSARY).stage, 0);
  assert.equal(hasHan("가나다라 힣"), false);
  assert.equal(hasHan("\uF900"), true); // 호환 한자
  assert.equal(hasHan("\uAC00\uD7A3"), false); // 가, 힣 (예전 오타 범위 U+8C48–FAFF 였다면 걸렸을 글자)
  assert.equal(hasHan(null), false);
});

test("HAN_RE·HANGUL_RE 는 validate.ts 에서도 같은 객체로 다시 내보낸다 (periodic/validate 호환)", () => {
  assert.equal(validate.HAN_RE, HAN_RE);
  assert.equal(validate.HANGUL_RE, HANGUL_RE);
  assert.ok(HAN_RE.global);
  assert.deepEqual("무문신궁(無問芯穹)".match(HAN_RE)?.join(""), "無問芯穹");
  assert.equal(HANGUL_RE.test("한글"), true);
  assert.equal(HANGUL_RE.test("中文 English"), false);
});
