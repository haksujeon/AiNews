import { test } from "node:test";
import assert from "node:assert/strict";
import { SHADOW_MAX_ROWS, parseShadowBody } from "../../src/lib/classifier-shadow";

test("그림자 기록 본문: run_id·rows 필수, 형식이 틀린 값은 null, URL 없는 행·중복 URL 은 건너뛴다", () => {
  assert.equal(parseShadowBody(null).ok, false);
  assert.equal(parseShadowBody({ rows: [] }).ok, false);
  assert.equal(parseShadowBody({ run_id: "1", rows: "x" }).ok, false);
  assert.equal(parseShadowBody({ run_id: "1; drop", rows: [] }).ok, false);
  assert.equal(parseShadowBody({ run_id: 1, rows: Array(SHADOW_MAX_ROWS + 1).fill({}) }).ok, false);
  const r = parseShadowBody({
    run_id: 12345,
    rows: [
      { item_url: "https://www.huxiu.com/article/1.html", title: " 宇树上市 ", current_relevant: true, current_category: "ai-biz",
        v3_relevant: "Y", v3_category: "Robotics", current_kept: true, current_capped: false, v3_mode: "llm" },
      { item_url: "https://www.huxiu.com/article/1.html", title: "dup" },
      { item_url: "javascript:alert(1)" },
      { title: "no url" },
      { item_url: "https://36kr.com/p/2", v3_category: "ai biz; drop", current_category: 3 },
    ],
  });
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.runId, "12345");
  assert.equal(r.promptVersion, "v3");
  assert.equal(r.skipped, 3);
  assert.equal(r.rows.length, 2);
  assert.equal(r.rows[0].title, "宇树上市");
  assert.equal(r.rows[0].v3_relevant, null); // 문자열 "Y" 는 boolean 이 아니다
  assert.equal(r.rows[0].v3_category, "robotics");
  assert.equal(r.rows[0].current_kept, true);
  assert.equal(r.rows[1].v3_category, null);
  assert.equal(r.rows[1].current_category, null);
});
