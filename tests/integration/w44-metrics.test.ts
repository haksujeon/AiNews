/**
 * 통합 시험 (읽기 전용 DB) — 실행: npm run test:integration (.env.local 의 DATABASE_URL 필요)
 * DATABASE_URL 이 없으면(예: npm run test:unit) 건너뛴다.
 *
 * 2026-W44 고정값(설계 검토서 §8): 기사 562 / 지난주 568 / 같은 요일 560 대 521, 앤트로픽 101 / 89, 결손일 10-31.
 * 2026-11-02 재고정: 결손일 10-31 에 기사 14건이 더 수집되어 기사 576, 앤트로픽 104 (+17%). 같은 요일 비교는 10-31 을 빼므로 그대로.
 * 수집 보충으로 과거 기사가 늘면 이 값이 바뀔 수 있다 — 그때는 리포트 스냅숏 재계산 대상이므로 값을 갱신한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { Client } from "pg";
import { chinaVsOverseas, computePeriodMetrics, countBy, regionCounts, termCounts, volumeSummary } from "../../src/lib/metrics/period";
import { regionChipSql } from "../../src/lib/region";
import { buildFacts } from "../../src/lib/briefing/periodic/prompt";

const url = process.env.DATABASE_URL;
// 예전 언급 기준 지표 — '선전'(宣传 오탐) 제거 + 10-31 기사 14건 추가 수집 후 (이전: 해외 40.9 / 중국 33.6)
const LEGACY_FOREIGN = 40.8;
const LEGACY_CHINA = 34.2;

test("2026-W44 지표 고정값 + 통계·리포트 공용 함수 일치 (READ ONLY)", { skip: !url && "DATABASE_URL 없음" }, async () => {
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    await c.query("BEGIN READ ONLY");
    const { metrics: m, articles } = await computePeriodMetrics(c, {
      kind: "weekly", start: "2026-10-26", end: "2026-11-01", prevStart: "2026-10-19", prevEnd: "2026-10-25", population: "ai",
    });
    assert.equal(m.volume.total, 576);
    assert.equal(m.volume.prev_total, 568);
    assert.equal(m.volume.like_for_like?.cur, 560);
    assert.equal(m.volume.like_for_like?.prev, 521);
    assert.equal(m.volume.like_for_like?.display_change, "+7%");
    assert.deepEqual(m.data_quality.incomplete_days, ["2026-10-31"]);
    assert.equal(m.data_quality.expected_weekend_median, 43);
    const anthropic = m.entities.find((e) => e.key === "anthropic")!;
    assert.equal(anthropic.cur, 104);
    assert.equal(anthropic.prev, 89);
    assert.equal(anthropic.display_change, "+17%");
    // v3: 언급 기준 china_vs_overseas 는 새 스냅숏에 없다 (예전 스냅숏 전용). 함수는 남아 있다 — '선전' 제거 후 값
    assert.equal(m.china_vs_overseas, undefined);
    const legacy = chinaVsOverseas(articles);
    assert.equal(legacy.foreign_pct, LEGACY_FOREIGN);
    assert.equal(legacy.china_pct, LEGACY_CHINA);
    // v3: 대표 지역 비중 — 홈 칩·통계 페이지와 같은 regionCounts, 칩 SQL 과 건수가 같다
    const rs = m.region_share!.cur;
    assert.deepEqual(rs, await regionCounts(c, { population: "ai", range: { start: "2026-10-26", end: "2026-11-01" } }));
    assert.equal(rs.buckets.CN + rs.buckets.US + rs.buckets.OTHER + rs.unclassified, rs.total);
    assert.equal(rs.total, m.volume.total);
    for (const chip of ["CN", "US", "OTHER"] as const) {
      const { rows } = await c.query(
        `SELECT COUNT(*)::int AS n FROM ai_news_ex WHERE id = ANY($1::uuid[]) AND ${regionChipSql(chip)}`,
        [articles.map((a) => a.id)]
      );
      assert.equal(rows[0].n, rs.buckets[chip], chip);
    }
    assert.ok(rs.unclassified_pct <= 2, `미판정 ${rs.unclassified_pct}%`);
    assert.equal(buildFacts(m)["vol.lfl_change"], "+7%");

    // Gate 2: 리포트의 매체·분야·용어 수는 통계 페이지와 같은 SQL 함수(같은 모집단·기간)에서 나온다
    const range = { start: "2026-10-26", end: "2026-11-01" };
    const src = await countBy(c, "source_name", { population: "ai", range });
    assert.deepEqual(m.sources.map((s) => [s.name, s.cur]), src.map((s) => [s.name, s.value]));
    const terms = await termCounts(c, { population: "ai", range, limit: 3 });
    assert.deepEqual(m.terms.top.slice(0, 3).map((t) => [t.term, t.cur]), terms.map((t) => [t.term, t.count]));
    const vol = await volumeSummary(c, { population: "ai", range });
    assert.equal(vol.total, m.volume.total);
    // 통계 페이지(전체 모집단)의 AI 분야 건수 = 리포트 모집단(ai) 전체 기간 건수
    const all = await volumeSummary(c, { population: "all" });
    const ai = await volumeSummary(c, { population: "ai" });
    assert.equal(all.ai, ai.total);
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    await c.end();
  }
});
