import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY_FILTERS, newsSearchString, parseFilters, parseNewsView } from "../../src/lib/news-query";

// QA B-02: 뉴스 필터·보기 방식이 주소에 남고, 서버(parseFilters)가 같은 값으로 되읽는다

test("필터 없음·격자 보기 → 빈 주소, 남의 키는 그대로", () => {
  assert.equal(newsSearchString("", EMPTY_FILTERS, "grid"), "");
  assert.equal(newsSearchString("?briefing=2026-11-09", EMPTY_FILTERS, "grid"), "?briefing=2026-11-09");
});

test("필터를 쓰고 되읽으면 같은 값", () => {
  const f = { ...EMPTY_FILTERS, q: " 딥시크 ", region: "CN" as const, categories: ["ai-tech"], from: "2026-11-05", to: "2026-11-06" };
  const s = newsSearchString("?q=old&focus=search", f, "list");
  const p = new URLSearchParams(s);
  assert.equal(p.get("focus"), null);
  assert.equal(parseNewsView(p.get("view")), "list");
  assert.deepEqual(parseFilters(p), { ...f, q: "딥시크" });
});

test("필터를 지우면 주소에서도 빠진다", () => {
  assert.equal(newsSearchString("?q=a&region=CN&categories=ai-tech&view=list&briefing=2026-11-09", EMPTY_FILTERS, "grid"), "?briefing=2026-11-09");
});

test("모르는 보기 값은 grid", () => {
  assert.equal(parseNewsView("table"), "grid");
  assert.equal(parseNewsView(null), "grid");
});
