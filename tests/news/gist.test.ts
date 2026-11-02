/** 본문 번역 요지(src/lib/news-gist.ts) 단위 테스트 — 실행: npm run test:unit */
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitSentences, toGist, toPublicNewsItem } from "../../src/lib/news-gist";
import type { NewsItem } from "../../src/lib/news-types";

const ko = (n: number) => Array.from({ length: n }, (_, i) => `${i + 1}번째 문장은 시험용 문장이다.`);

test("3문장 미만이면 원문 그대로", () => {
  const two = "아마존은 3분기 실적을 발표했다. 시장 기대에 못 미쳤다.";
  assert.equal(toGist(two, "ko"), two);
  assert.equal(toGist("한 문장뿐이다", "ko"), "한 문장뿐이다");
  assert.equal(toGist("", "ko"), "");
  assert.equal(toGist(null, "ko"), "");
});

test("10문장이면 앞 5문장", () => {
  const s = ko(10);
  const gist = toGist(s.join(" "), "ko");
  assert.equal(gist, s.slice(0, 5).join(" "));
  assert.equal(splitSentences(gist).length, 5);
  assert.ok(!gist.includes("6번째"));
});

test("숫자·소수점·천 단위 쉼표는 문장 경계가 아니다", () => {
  const text =
    "총매출은 2,019억 달러로 전년 대비 12.1% 증가했다. 영업이익률은 13.9%로 역대 최고다. 연구개발비는 약 286.68만 위안이다. GPT-4.5 와 v1.5 를 비교했다.";
  assert.deepEqual(splitSentences(text), [
    "총매출은 2,019억 달러로 전년 대비 12.1% 증가했다.",
    "영업이익률은 13.9%로 역대 최고다.",
    "연구개발비는 약 286.68만 위안이다.",
    "GPT-4.5 와 v1.5 를 비교했다.",
  ]);
});

test("중국어 문장부호(。！？)는 공백 없이도 나누고, 이어 붙일 때 공백을 넣지 않는다", () => {
  const zh = "第一句话。第二句话！第三句话？第四句话。第五句话。第六句话。";
  assert.deepEqual(splitSentences(zh).length, 6);
  assert.equal(toGist(zh, "zh"), "第一句话。第二句话！第三句话？第四句话。第五句话。");
  // 닫는 따옴표는 앞 문장에 붙는다
  assert.deepEqual(splitSentences("他说：“好。”然后走了。"), ["他说：“好。”", "然后走了。"]);
});

test("영어 문장부호: ?! 묶음, 닫는 따옴표, 대문자 약어", () => {
  const en = 'Really?! Yes. He said "done." The U.S. market grew 3.5%. Prices rose. Then fell. Sixth one.';
  assert.deepEqual(splitSentences(en), [
    "Really?!",
    "Yes.",
    'He said "done."',
    "The U.S. market grew 3.5%.",
    "Prices rose.",
    "Then fell.",
    "Sixth one.",
  ]);
  assert.equal(splitSentences(toGist(en, "en")).length, 5);
});

test("줄바꿈(문단)은 문장 경계", () => {
  assert.deepEqual(splitSentences("소제목\n본문 첫 문장이다.\n\n둘째 문단이다."), ["소제목", "본문 첫 문장이다.", "둘째 문단이다."]);
});

test("ko 600자 상한: 상한을 넘기는 문장은 넣지 않는다", () => {
  const long = Array.from({ length: 8 }, (_, i) => `${i}${"가".repeat(180)}다.`).join(" ");
  const gist = toGist(long, "ko");
  assert.ok(gist.length <= 600, `length ${gist.length}`);
  assert.equal(splitSentences(gist).length, 3);
  // 첫 문장만으로 상한을 넘으면 잘라서 … 를 붙인다
  const one = `${"나".repeat(900)}다. 짧은 문장이다. 또 하나다.`;
  const cut = toGist(one, "ko");
  assert.equal(cut.length, 600);
  assert.ok(cut.endsWith("…"));
  // 2문장이라도 상한은 지킨다
  assert.ok(toGist(`${"다".repeat(700)}. 끝.`, "ko").length <= 600);
});

test("toPublicNewsItem: content_* 키를 빼고 gist 를 넣는다(zh 는 빈 요지)", () => {
  const news = {
    id: "x",
    title_kr: "제목",
    content_kr: ko(8).join(" "),
    content_en: "One. Two. Three. Four. Five. Six. Seven.",
    source_url: "https://example.com/a",
  } as unknown as NewsItem;
  const koItem = toPublicNewsItem(news, "ko");
  assert.ok(!("content_kr" in koItem) && !("content_en" in koItem));
  assert.equal(koItem.gist, ko(5).join(" "));
  assert.equal(koItem.title_kr, "제목");
  assert.equal(toPublicNewsItem(news, "en").gist, "One. Two. Three. Four. Five.");
  assert.equal(toPublicNewsItem(news, "zh").gist, "");
  assert.ok(!JSON.stringify(toPublicNewsItem(news, "zh")).includes("6번째"));
});
