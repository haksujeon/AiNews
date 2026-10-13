/**
 * 공개 읽기의 숨김 처리(pruneToVisible) 단위 테스트 — 실행: npm run test:unit
 * 숨긴 기사 링크는 빠지고, 그 기사만 근거로 둔 항목은 통째로 빠져야 한다 (설계 검토서 §4).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { pruneToVisible } from "../../src/lib/briefing/public";
import type { StoredBriefingContent } from "../../src/lib/briefing/types";

const content: StoredBriefingContent = {
  headline: "h",
  lede: "l",
  lede_refs: ["a", "b"],
  top_stories: [
    { rank: 1, section: "models", subject: "x", subject_is_chinese: true, title: "t1", what: "w", why: "y", refs: ["a", "b"], primary_ref: "b" },
    { rank: 2, section: "chips", subject: "x", subject_is_chinese: true, title: "t2", what: "w", why: "y", refs: ["b"], primary_ref: "b" },
    { rank: 3, section: "funding", subject: "x", subject_is_chinese: true, title: "t3", what: "w", why: "y", refs: ["c"], primary_ref: "c" },
  ],
  sections: [{ section: "products", items: [{ text: "s1", refs: ["b"] }] }],
  key_numbers: [{ value: "1%", label: "k", ref: "b" }, { value: "2%", label: "k", ref: "c" }],
  companies_to_watch: [{ name: "n", why: "w", refs: ["a", "b"] }],
  term_of_the_day: { term: "具身智能", pinyin: "jù shēn zhì néng", ref: "b" },
  clusters: [{ story: "s", ids: ["a", "b"] }],
  excluded: [{ id: "z", reason: "r" }],
  meta: {
    edition_date: "2026-10-13", locale: "ko", mode: "normal", candidate_count: 3, group_count: 3, cited_count: 3,
    china_centric_count: 3, prompt_version: "v", ai_generated: true,
  },
};

test("숨긴 기사(b)는 refs 에서 빠지고, b 만 근거인 항목은 사라지며 순위가 다시 매겨진다", () => {
  const c = pruneToVisible(content, new Set(["a", "c"]));
  assert.deepEqual(c.lede_refs, ["a"]);
  assert.deepEqual(c.top_stories.map((s) => [s.rank, s.title, s.refs, s.primary_ref]), [
    [1, "t1", ["a"], "a"],
    [2, "t3", ["c"], "c"],
  ]);
  assert.equal(c.sections.length, 0);
  assert.deepEqual(c.key_numbers.map((k) => k.ref), ["c"]);
  assert.deepEqual(c.companies_to_watch[0].refs, ["a"]);
  assert.equal(c.term_of_the_day, null);
  assert.equal(c.clusters.length, 0); // 1건만 남은 묶음은 묶음이 아니다
  assert.equal(c.excluded.length, 0); // 내부용 필드는 공개하지 않음
  assert.equal(content.top_stories.length, 3, "원본은 바꾸지 않는다");
});
