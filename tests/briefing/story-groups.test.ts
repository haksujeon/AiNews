/**
 * 주요 기사 묶음 "중국 5 · 해외 3" (story-groups.ts) — 실행: npm run test:unit
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import type { TopStory } from "../../src/lib/briefing/types";
import { arrangeTopStories, copyGroups, displayNo, isGrouped, mailStories, storyGroups } from "../../src/lib/briefing/story-groups";

const st = (rank: number, cn: boolean, extra: Partial<TopStory> = {}): TopStory => ({
  rank, section: "models", subject: cn ? "딥시크" : "OpenAI", subject_is_chinese: cn, title: `t${rank}`, what: "w", why: "y", refs: [`A0${rank}`], primary_ref: `A0${rank}`, ...extra,
});

test("arrange: 중국 묶음 앞(원래 순서 유지)·해외 뒤, 상한(중국 5·해외 3) 넘으면 빼고 rank 다시", () => {
  const input = [st(1, false), st(2, true), st(3, true), st(4, false), st(5, true), st(6, true), st(7, true), st(8, true), st(9, false), st(10, false)];
  const { content, edits } = arrangeTopStories({ top_stories: input }, (s) => s.subject_is_chinese);
  assert.deepEqual(content.top_stories.map((s) => s.title), ["t2", "t3", "t5", "t6", "t7", "t1", "t4", "t9"]);
  assert.deepEqual(content.top_stories.map((s) => s.rank), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(content.top_stories.map((s) => s.group), ["cn", "cn", "cn", "cn", "cn", "intl", "intl", "intl"]);
  assert.equal(edits.length, 2); // t8(중국 6번째)·t10(해외 4번째)
  // 멱등
  const again = arrangeTopStories(content, (s) => s.subject_is_chinese);
  assert.deepEqual(again.content, content);
  assert.equal(again.edits.length, 0);
});

test("중국 기사가 모자란 날: 있는 만큼만 (해외로 채우지 않음)", () => {
  const { content } = arrangeTopStories({ top_stories: [st(1, true), st(2, false), st(3, true), st(4, false), st(5, false), st(6, false)] }, (s) => s.subject_is_chinese);
  assert.equal(content.top_stories.filter((s) => s.group === "cn").length, 2);
  assert.equal(content.top_stories.filter((s) => s.group === "intl").length, 3);
});

test("보이는 번호: 묶은 판은 중국 1~5 · 해외 1~3, 예전 판은 rank 그대로", () => {
  const { content } = arrangeTopStories({ top_stories: [st(1, true), st(2, true), st(3, false), st(4, true), st(5, false)] }, (s) => s.subject_is_chinese);
  const all = content.top_stories;
  assert.deepEqual(all.map((s) => displayNo(s, all)), [1, 2, 3, 1, 2]);
  assert.deepEqual(storyGroups(all).map((g) => [g.group, g.stories.length]), [["cn", 3], ["intl", 2]]);
  const old = [st(1, false), st(2, true)];
  assert.equal(isGrouped(old), false);
  assert.deepEqual(old.map((s) => displayNo(s, old)), [1, 2]);
  assert.deepEqual(storyGroups(old).map((g) => g.group), [null]);
});

test("메일: 묶은 판은 중국 묶음만 본문, 해외는 제목 상자 / 예전 판은 전부 본문", () => {
  const { content } = arrangeTopStories({ top_stories: [st(1, true), st(2, false), st(3, true)] }, (s) => s.subject_is_chinese);
  const m = mailStories(content.top_stories);
  assert.deepEqual(m.main.map((s) => s.title), ["t1", "t3"]);
  assert.deepEqual(m.intl.map((s) => s.title), ["t2"]);
  assert.equal(mailStories([st(1, false), st(2, true)]).main.length, 2);
});

test("번역판은 ko 판의 group 을 순서대로 이어받는다 (길이가 다르면 손대지 않음)", () => {
  const ko = arrangeTopStories({ top_stories: [st(1, true), st(2, false)] }, (s) => s.subject_is_chinese).content;
  const zh = { top_stories: [st(1, true, { title: "中1" }), st(2, false, { title: "外1" })] };
  assert.deepEqual(copyGroups(zh, ko).top_stories.map((s) => s.group), ["cn", "intl"]);
  assert.equal(isGrouped(copyGroups({ top_stories: [st(1, true)] }, ko).top_stories), false);
});
