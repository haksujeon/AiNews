/** 썸네일 판별(normalizeImageUrl / getImageUrl) 단위 테스트 — 실행: npm run test:unit */
import { test } from "node:test";
import assert from "node:assert/strict";
import { getImageUrl, isRealImage, normalizeImageUrl } from "../../src/lib/news-utils";

test("量子位 로고·기자 아바타(-100x100)·虎嗅 AI 커버는 이미지 없음", () => {
  assert.equal(normalizeImageUrl("http://www.qbitai.com/wp-content/themes/liangziwei/imagesnew/head.jpg"), null);
  assert.equal(normalizeImageUrl("https://www.qbitai.com/wp-content/themes/liangziwei/imagesnew/head.jpg"), null);
  assert.equal(normalizeImageUrl("http://www.qbitai.com/wp-content/uploads/2026/10/avatar-100x100.jpg"), null);
  assert.equal(normalizeImageUrl("https://www.qbitai.com/wp-content/uploads/2026/10/avatar-100x100.png"), null);
  assert.equal(normalizeImageUrl("https://img.huxiucdn.com/ai-general-cover/x.jpg"), null);
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
