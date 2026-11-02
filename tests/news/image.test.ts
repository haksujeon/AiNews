/** 썸네일 판별(normalizeImageUrl / getImageUrl) 단위 테스트 — 실행: npm run test:unit */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getImageUrl, isAiGeneratedImage, isRealImage, normalizeImageUrl } from "../../src/lib/news-utils";

test("量子位 로고·기자 아바타(-100x100)는 이미지 없음", () => {
  assert.equal(normalizeImageUrl("http://www.qbitai.com/wp-content/themes/liangziwei/imagesnew/head.jpg"), null);
  assert.equal(normalizeImageUrl("https://www.qbitai.com/wp-content/themes/liangziwei/imagesnew/head.jpg"), null);
  assert.equal(normalizeImageUrl("http://www.qbitai.com/wp-content/uploads/2026/10/avatar-100x100.jpg"), null);
  assert.equal(normalizeImageUrl("https://www.qbitai.com/wp-content/uploads/2026/10/avatar-100x100.png"), null);
});

test("虎嗅 AI 생성 커버는 이미지로 쓰고(2026-11-02 정책) AI 생성으로 판별한다", () => {
  const cover = "https://img.huxiucdn.com/ai/ai-general-cover/202611/02/41434-prod-nb2qn-general-1-1793549381002.png";
  assert.equal(normalizeImageUrl(cover), cover);
  assert.equal(isRealImage(cover), true);
  assert.equal(getImageUrl({ thumbnail_url: cover, og_image_url: null }), cover);
  assert.equal(isAiGeneratedImage(cover), true);
  assert.equal(isAiGeneratedImage("https://img.huxiucdn.com/article/content/26-11-02/a.png"), false);
  assert.equal(isAiGeneratedImage(null), false);
});

test("http 이미지: https 를 확인한 호스트만 올리고 나머지는 버린다", () => {
  assert.equal(
    normalizeImageUrl("http://www.qbitai.com/wp-content/uploads/2026/10/cover.jpg"),
    "https://www.qbitai.com/wp-content/uploads/2026/10/cover.jpg"
  );
  assert.equal(normalizeImageUrl("http://img.example.cn/a.jpg"), null);
  assert.equal(normalizeImageUrl("//img.ithome.com/a.jpg"), "https://img.ithome.com/a.jpg");
  assert.equal(normalizeImageUrl("https://img.ithome.com/a-1000x600.jpg"), "https://img.ithome.com/a-1000x600.jpg");
});

test("getImageUrl: 썸네일이 아바타면 OG 이미지로 넘어간다, isRealImage 는 그대로 쓸 수 있는 URL 만", () => {
  assert.equal(
    getImageUrl({ thumbnail_url: "https://www.qbitai.com/u/a-100x100.jpg", og_image_url: "https://www.qbitai.com/u/cover.png" }),
    "https://www.qbitai.com/u/cover.png"
  );
  assert.equal(getImageUrl({ thumbnail_url: null, og_image_url: "http://img.example.cn/a.jpg" }), null);
  assert.equal(isRealImage("https://img.ithome.com/a.jpg"), true);
  assert.equal(isRealImage("http://www.qbitai.com/u/cover.jpg"), false); // 올린 URL 을 써야 한다
});
