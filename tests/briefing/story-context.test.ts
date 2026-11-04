/** "지금까지의 이야기" 시범 — 공개 기사만 남기기·관점 순서·붙이기 (story-context.ts) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { attachStoryContext, toStoryContexts } from "../../src/lib/briefing/story-context";

const ref = (id: string) => ({ id, source: "36Kr", title: id });
const row = (lens: "company" | "topic", ids: string[][]) => ({
  id: "a1", lens, thread_title: lens, background: "b", now_text: "n", caution: "",
  timeline: ids.map((r, i) => ({ date: `2026-10-0${i + 1}`, text: `t${i}`, refs: r.map(ref) })),
});

test("숨긴 근거는 빼고, 근거가 없어진 항목은 버리고, 2개 미만이면 관점째 뺀다. 순서는 회사 → 주제", () => {
  const m = toStoryContexts([row("topic", [["x"], ["y"], ["h"]]), row("company", [["x", "h"], ["h"]])], new Set(["x", "y"]));
  const list = m.get("a1")!;
  assert.deepEqual(list.map((c) => c.lens), ["topic"]);
  assert.equal(list[0].timeline.length, 2);
  assert.equal(list[0].caution, null);

  const both = toStoryContexts([row("topic", [["x"], ["y"]]), row("company", [["x"], ["y"]])], new Set(["x", "y"]));
  assert.deepEqual(both.get("a1")!.map((c) => c.lens), ["company", "topic"]);
});

test("근거 기사 키로 붙인다 (primary_ref 먼저, 없으면 refs)", () => {
  const m = toStoryContexts([row("company", [["x"], ["y"]])], new Set(["x", "y"]));
  const out = attachStoryContext([{ refs: ["z", "a1"], primary_ref: "z" }, { refs: ["q"], primary_ref: "q" }], m);
  assert.equal(out[0].story_context?.[0].lens, "company");
  assert.equal(out[1].story_context, undefined);
});
