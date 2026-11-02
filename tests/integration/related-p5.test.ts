/**
 * 관련 기사 회귀 시험 (읽기 전용 DB) — 실행: npm run test:integration
 * 관련 기사 검토(2026-11-02)의 블라인드 라벨(tests/fixtures/related-labels.json)로 findRelated 의 p@5 를 잰다.
 *  - p@5 strict = 상위 5건 중 라벨 2(관련) 수 / 5. 라벨 없는 후보·빈 칸은 0 (evaluate.py 와 같은 규칙).
 *  - 라벨은 예전 방식들이 낸 후보에만 붙어 있어, 새 방식이 처음 고른 기사는 "라벨 없음 = 0" 으로 낮게 잡힌다 → 라벨 없는 건수도 함께 출력.
 *  - DB 가 계속 바뀌므로(수집·재분류) 하한은 기존 방식(0.02)보다 확실히 높은 값으로만 둔다.
 * rankRelated 를 바꾸면(검토 결론 반영) 이 시험의 출력으로 전후를 비교한다.
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

test("관련 기사 p@5 (라벨 20건) — 기존 방식보다 높다", { skip: !url && "DATABASE_URL 없음" }, async () => {
  const { findRelated } = await import("../../src/lib/related");
  const { default: pool } = await import("../../src/lib/db");
  try {
    let strict = 0;
    let soft = 0;
    let unlabeled = 0;
    let shown = 0;
    let covered = 0;
    const per: Record<string, number[]> = {};
    for (const seed of fx.seeds) {
      const items = await findRelated(seed, { limit: 5 });
      const lab = items.map((it) => {
        const v = fx.labels[seed]?.[it.id.slice(0, 8)];
        if (v === undefined) unlabeled++;
        return v ?? 0;
      });
      shown += items.length;
      strict += lab.filter((v) => v === 2).length / 5;
      soft += lab.reduce((s, v) => s + (v === 2 ? 1 : v === 1 ? 0.5 : 0), 0) / 5;
      if (lab.includes(2)) covered++;
      per[seed.slice(0, 8)] = lab;
    }
    const n = fx.seeds.length;
    const p5 = Math.round((strict / n) * 1000) / 1000;
    const report = {
      p5_strict: p5,
      p5_soft: Math.round((soft / n) * 1000) / 1000,
      coverage: `${covered}/${n}`,
      shown,
      unlabeled,
      baseline: fx.baseline_p5_strict,
      per_seed: per,
    };
    console.log(JSON.stringify(report));
    assert.ok(p5 > (fx.baseline_p5_strict["current (prod)"] ?? 0) + 0.1, `p@5 ${p5}`);
  } finally {
    await pool.end();
  }
});
