/**
 * 관련 기사 회귀 시험 (DB, related_articles 에 쓴다) — 실행: npm run test:integration
 * 관련 기사 검토(2026-11-02)의 블라인드 라벨(tests/fixtures/related-labels.json)로 지금 DB 의 p@5 를 잰다.
 *  - p@5 strict = rankRelated 한 줄 목록(ranked) 상위 5건 중 라벨 2 / 5. 라벨 없는 후보·빈 칸은 0 (evaluate.py 와 같은 규칙).
 *  - 후보·idf 는 운영과 같은 loadWindow(기준 기사 ±90일). DB 가 바뀌므로 하한은 고정본 시험(tests/news/related-eval.test.ts, 0.35)보다 낮게.
 *  - findRelated(화면이 쓰는 묶음)가 표에 계산 표시 행을 남기고, 두 번째 읽기가 같은 결과인지도 본다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const url = process.env.DATABASE_URL;
const fx = JSON.parse(readFileSync(join(__dirname, "../fixtures/related-labels.json"), "utf8")) as {
  seeds: string[];
  labels: Record<string, Record<string, number>>;
  baseline_p5_strict: Record<string, number>;
};

test("관련 기사 p@5 (라벨 20건) — 기존 방식보다 확실히 높다", { skip: !url && "DATABASE_URL 없음" }, async () => {
  const { loadWindow, rankRelated, findRelated, relatedIds } = await import("../../src/lib/related");
  const { default: pool } = await import("../../src/lib/db");
  try {
    let strict = 0;
    let soft = 0;
    let unlabeled = 0;
    let covered = 0;
    const per: Record<string, number[]> = {};
    for (const seedId of fx.seeds) {
      const { rows } = await pool.query(
        `SELECT id, source_name, category, title_cn, title_kr, title_en, left(summary_kr, 220) AS summary_kr, summary_cn, summary_en,
                ARRAY(SELECT e->>'term' FROM jsonb_array_elements(CASE WHEN jsonb_typeof(key_terms) = 'array' THEN key_terms ELSE '[]' END) e) AS terms,
                to_char(news_date AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day
           FROM ai_news_ex WHERE id = $1`,
        [seedId]
      );
      const seed = rows[0];
      const ranked = rankRelated(seed, await loadWindow(seed.day)).ranked.slice(0, 5);
      const lab = ranked.map((r) => {
        const v = fx.labels[seedId]?.[r.item.id.slice(0, 8)];
        if (v === undefined) unlabeled++;
        return v ?? 0;
      });
      strict += lab.filter((v) => v === 2).length / 5;
      soft += lab.reduce((s, v) => s + (v === 2 ? 1 : v === 1 ? 0.5 : 0), 0) / 5;
      if (lab.includes(2)) covered++;
      per[seedId.slice(0, 8)] = lab;
    }
    const n = fx.seeds.length;
    const p5 = Math.round((strict / n) * 1000) / 1000;
    console.log(JSON.stringify({ p5_strict: p5, p5_soft: Math.round((soft / n) * 1000) / 1000, coverage: `${covered}/${n}`, unlabeled, baseline: fx.baseline_p5_strict, per_seed: per }));
    assert.ok(p5 >= 0.3, `p@5 ${p5}`);

    // 화면 경로: 계산 → 저장 → 다시 읽기가 같은 묶음
    const seedId = fx.seeds[0];
    const first = relatedIds(await findRelated(seedId));
    const again = relatedIds(await findRelated(seedId));
    assert.deepEqual(again, first);
    const { rows: meta } = await pool.query(`SELECT count(*)::int AS n FROM related_articles WHERE news_id = $1 AND section = '_meta'`, [seedId]);
    assert.equal(meta[0].n, 1);
  } finally {
    await new Promise((r) => setTimeout(r, 200)); // 응답 뒤 계산(after 대체)이 끝날 틈
    await pool.end();
  }
});
