/**
 * 신뢰 페이지 마크다운 렌더러(markdown.tsx) 단위 테스트 — 실행: npm run test:unit
 * 블록 분해, 주석 제거, {{변수}} 치환, 링크 허용 목록(https·mailto·사이트 경로만).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fillVars, parseMarkdown, safeHref } from "../../src/lib/trust/markdown";

test("제목·문단·목록·구분선으로 나누고 # 은 h2 로 낮춘다", () => {
  const blocks = parseMarkdown("# 큰 제목\n\n첫 줄\n이어지는 줄\n\n- 가\n- 나\n\n1. 하나\n2. 둘\n\n---\n\n### 작은 제목");
  assert.deepEqual(blocks, [
    { type: "h2", text: "큰 제목" },
    { type: "p", text: "첫 줄 이어지는 줄" },
    { type: "ul", items: ["가", "나"] },
    { type: "ol", items: ["하나", "둘"] },
    { type: "hr" },
    { type: "h3", text: "작은 제목" },
  ]);
});

test("HTML 주석은 지우고, 원문 HTML 은 글자로 남긴다", () => {
  const blocks = parseMarkdown("<!-- DRAFT\n여러 줄 -->\n<script>alert(1)</script>");
  assert.deepEqual(blocks, [{ type: "p", text: "<script>alert(1)</script>" }]);
});

test("{{변수}} 치환, 모르는 이름은 그대로", () => {
  assert.equal(fillVars("메일 {{contactEmail}} / {{ x }}", { contactEmail: "a@b.c" }), "메일 a@b.c / {{ x }}");
});

test("safeHref: https·mailto·사이트 경로만 허용", () => {
  assert.equal(safeHref("https://example.com/a"), "https://example.com/a");
  assert.equal(safeHref("mailto:contact@aibaseclub.com"), "mailto:contact@aibaseclub.com");
  assert.equal(safeHref("/methodology"), "/methodology");
  assert.equal(safeHref("javascript:alert(1)"), null);
  assert.equal(safeHref("http://example.com"), null);
  assert.equal(safeHref("//evil.example"), null);
  assert.equal(safeHref("data:text/html,x"), null);
});
