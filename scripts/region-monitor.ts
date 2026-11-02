/**
 * 대상 지역 감시 보고 (읽기 전용). 운영 점검 방법: ~/ainews-reports/region-taxonomy/MONITORING.md
 *
 *   npx tsx --env-file=.env.local scripts/region-monitor.ts                  # 최근 1일(베이징 날짜) + 직전 14일 기준선
 *   npx tsx --env-file=.env.local scripts/region-monitor.ts --days 3         # 최근 3일
 *   npx tsx --env-file=.env.local scripts/region-monitor.ts --since 2026-11-02 --sample 30 --strict
 *     --strict: 경고가 하나라도 있으면 종료 코드 2 (cron·알림용)
 *     --json:   표 대신 JSON 한 덩어리
 *
 * 보는 것:
 *  1. 날짜별·매체별 분포 (중국 / 미국 / 그 밖 비중, 미판정 비율, 미중·한국 태그 수, 판정 경로 region_version)
 *  2. 경고: 미판정 > 2%, 한국(KR 대표 지역) 비중 > 2% 또는 하루 5건 이상, 버킷 비중이 기준선(직전 14일)보다 15%p 넘게 움직임
 *  3. 규칙 대 LLM 불일치: 감시 기간에 LLM(n8n·백필)이 판정한 행 중 고신뢰 규칙이 판정할 수 있는 행에서 대표 지역이 다른 비율 (경고 > 10%)
 *  4. 무작위 표본 N건 (사람이 눈으로 확인)
 * 칩 버킷은 src/lib/region.ts 의 REGION_BUCKET_SQL·highConfidenceRegion 을 그대로 쓴다 (화면·백필과 같은 규칙).
 */
import pool from "../src/lib/db";
import { PUBLIC_NEWS_WHERE } from "../src/lib/news-query";
import { REGION_BUCKET_SQL, REGION_VERSION, highConfidenceRegion } from "../src/lib/region";
import { addDays, beijingDate, DAY_SQL } from "../src/lib/metrics/period";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

export const THRESHOLDS = {
  null_pct: 2,
  kr_pct: 2,
  kr_daily: 5,
  shift_pp: 15,
  disagree_pct: 10,
  baseline_days: 14,
  /** 하루 기사가 이보다 적으면 비중 변화 경고를 내지 않는다 (부분 수집일) */
  min_day_rows: 20,
} as const;

interface DayRow {
  day: string;
  source_name: string;
  n: number;
  nulls: number;
  cn: number;
  us: number;
  other: number;
  kr_primary: number;
  us_china: number;
  korea_tag: number;
}

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : 0);

async function main() {
  const days = Math.max(1, Number(arg("--days") ?? "1"));
  const today = beijingDate();
  const since = arg("--since") ?? addDays(today, -(days - 1));
  const baseStart = addDays(since, -THRESHOLDS.baseline_days);
  const sampleN = Math.max(0, Number(arg("--sample") ?? "20"));
  const asJson = process.argv.includes("--json");
  const c = await pool.connect();
  const warns: string[] = [];
  try {
    await c.query("BEGIN READ ONLY");
    const { rows } = await c.query(
      `SELECT to_char(${DAY_SQL}, 'YYYY-MM-DD') AS day, COALESCE(source_name, 'Unknown') AS source_name,
              COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE subject_region IS NULL)::int AS nulls,
              COUNT(*) FILTER (WHERE ${REGION_BUCKET_SQL} = 'CN')::int AS cn,
              COUNT(*) FILTER (WHERE ${REGION_BUCKET_SQL} = 'US')::int AS us,
              COUNT(*) FILTER (WHERE ${REGION_BUCKET_SQL} = 'OTHER')::int AS other,
              COUNT(*) FILTER (WHERE subject_region = 'KR')::int AS kr_primary,
              COUNT(*) FILTER (WHERE region_tags @> ARRAY['CN','US']::text[])::int AS us_china,
              COUNT(*) FILTER (WHERE 'KR' = ANY(region_tags))::int AS korea_tag
         FROM ai_news_ex
        WHERE ${PUBLIC_NEWS_WHERE} AND news_date >= ($1::date)::timestamp AT TIME ZONE 'UTC'
        GROUP BY 1, 2 ORDER BY 1, 2`,
      [baseStart]
    );
    const all = rows as DayRow[];
    const cur = all.filter((r) => r.day >= since);
    const base = all.filter((r) => r.day < since);
    const sum = (xs: DayRow[]) =>
      xs.reduce(
        (a, r) => ({ n: a.n + r.n, nulls: a.nulls + r.nulls, cn: a.cn + r.cn, us: a.us + r.us, other: a.other + r.other, kr: a.kr + r.kr_primary, uc: a.uc + r.us_china, kt: a.kt + r.korea_tag }),
        { n: 0, nulls: 0, cn: 0, us: 0, other: 0, kr: 0, uc: 0, kt: 0 }
      );
    const shares = (s: ReturnType<typeof sum>) => {
      const cls = s.n - s.nulls;
      return { cn: pct(s.cn, cls), us: pct(s.us, cls), other: pct(s.other, cls) };
    };
    const b = sum(base);
    const bShare = shares(b);

    // 1. 날짜별
    const dayList = [...new Set(cur.map((r) => r.day))].sort();
    const perDay = dayList.map((day) => {
      const s = sum(cur.filter((r) => r.day === day));
      const sh = shares(s);
      const cls = s.n - s.nulls;
      const w: string[] = [];
      if (pct(s.nulls, s.n) > THRESHOLDS.null_pct) w.push(`미판정 ${pct(s.nulls, s.n)}% > ${THRESHOLDS.null_pct}%`);
      if (pct(s.kr, cls) > THRESHOLDS.kr_pct || s.kr >= THRESHOLDS.kr_daily) w.push(`한국 대표 지역 ${s.kr}건(${pct(s.kr, cls)}%)`);
      if (s.n >= THRESHOLDS.min_day_rows && b.n) {
        for (const k of ["cn", "us", "other"] as const) {
          const d = Math.round((sh[k] - bShare[k]) * 10) / 10;
          if (Math.abs(d) > THRESHOLDS.shift_pp) w.push(`${k.toUpperCase()} 비중 ${sh[k]}% (기준선 ${bShare[k]}%, ${d > 0 ? "+" : ""}${d}%p)`);
        }
      }
      for (const x of w) warns.push(`${day}: ${x}`);
      return { day, n: s.n, null_pct: pct(s.nulls, s.n), ...sh, us_china: s.uc, korea_tag: s.kt, kr_primary: s.kr, warnings: w };
    });

    // 매체별 (감시 기간 합계)
    const sources = [...new Set(cur.map((r) => r.source_name))].sort();
    const perSource = sources.map((src) => {
      const s = sum(cur.filter((r) => r.source_name === src));
      const bs = shares(sum(base.filter((r) => r.source_name === src)));
      return { source: src, n: s.n, null_pct: pct(s.nulls, s.n), ...shares(s), base: bs, us_china: s.uc };
    });

    // 판정 경로
    const { rows: ver } = await c.query(
      `SELECT COALESCE(region_version, '(none)') AS v, COUNT(*)::int AS n FROM ai_news_ex
        WHERE ${PUBLIC_NEWS_WHERE} AND news_date >= ($1::date)::timestamp AT TIME ZONE 'UTC' GROUP BY 1 ORDER BY 2 DESC`,
      [since]
    );

    // 3. 규칙 대 LLM 불일치 (LLM 이 판정한 행 중 규칙이 판정할 수 있는 행)
    const { rows: llmRows } = await c.query(
      `SELECT id::text, source_name, title_kr, title_cn, summary_kr, subject_region, region_version FROM ai_news_ex
        WHERE ${PUBLIC_NEWS_WHERE} AND news_date >= ($1::date)::timestamp AT TIME ZONE 'UTC'
          AND region_version IN ($2, $3)`,
      [since, REGION_VERSION.n8n, REGION_VERSION.llm]
    );
    let comparable = 0;
    const disagree: { id: string; title_kr: string; stored: string; rule: string; version: string }[] = [];
    for (const r of llmRows as { id: string; title_kr: string; title_cn: string; summary_kr: string; subject_region: string; region_version: string }[]) {
      const v = highConfidenceRegion(r);
      if (!v) continue;
      comparable++;
      if (v.subject_region !== r.subject_region) disagree.push({ id: r.id, title_kr: r.title_kr, stored: r.subject_region, rule: v.subject_region, version: r.region_version });
    }
    const disagreePct = pct(disagree.length, comparable);
    if (comparable >= 10 && disagreePct > THRESHOLDS.disagree_pct) warns.push(`규칙 대 LLM 불일치 ${disagreePct}% (${disagree.length}/${comparable}) > ${THRESHOLDS.disagree_pct}%`);

    // 4. 무작위 표본
    const { rows: sample } = await c.query(
      `SELECT id::text, source_name, to_char(${DAY_SQL}, 'YYYY-MM-DD') AS day, left(title_kr, 70) AS title_kr,
              COALESCE(subject_region, '∅') AS subject_region, region_tags, COALESCE(region_version, '') AS region_version
         FROM ai_news_ex WHERE ${PUBLIC_NEWS_WHERE} AND news_date >= ($1::date)::timestamp AT TIME ZONE 'UTC'
        ORDER BY random() LIMIT $2`,
      [since, sampleN]
    );
    await c.query("ROLLBACK");

    const report = { since, today, baseline: { start: baseStart, end: addDays(since, -1), n: b.n, ...bShare }, per_day: perDay, per_source: perSource, versions: ver, disagreement: { comparable, disagree: disagree.length, pct: disagreePct, examples: disagree.slice(0, 10) }, sample, warnings: warns };
    if (asJson) {
      console.log(JSON.stringify(report, null, 1));
    } else {
      console.log(`# 대상 지역 감시 ${since} ~ ${today} (기준선 ${report.baseline.start} ~ ${report.baseline.end}, ${b.n}건: 중국 ${bShare.cn}% · 미국 ${bShare.us}% · 그 밖 ${bShare.other}%)`);
      console.log("\n## 날짜별");
      console.table(perDay.map(({ warnings, ...r }) => ({ ...r, warn: warnings.length ? "⚠" : "" })));
      console.log("## 매체별 (감시 기간 / 기준선)");
      console.table(perSource.map((r) => ({ source: r.source, n: r.n, null_pct: r.null_pct, cn: `${r.cn} / ${r.base.cn}`, us: `${r.us} / ${r.base.us}`, other: `${r.other} / ${r.base.other}`, us_china: r.us_china })));
      console.log("## 판정 경로 (region_version)");
      console.table(ver);
      console.log(`## 규칙 대 LLM 불일치: ${disagree.length}/${comparable} (${disagreePct}%)`);
      for (const d of disagree.slice(0, 10)) console.log(`  ${d.stored} ← 저장(${d.version}) / 규칙 ${d.rule}  ${d.title_kr}  ${d.id}`);
      console.log(`\n## 무작위 표본 ${sample.length}건 (대표 지역 · 태그 · 경로 · 제목)`);
      for (const s of sample as { id: string; source_name: string; day: string; title_kr: string; subject_region: string; region_tags: string[]; region_version: string }[])
        console.log(`  ${s.day} ${s.source_name.padEnd(10)} ${s.subject_region.padEnd(6)} {${s.region_tags.join(",")}} ${s.region_version.padEnd(7)} ${s.title_kr}`);
      console.log(warns.length ? `\n## 경고 ${warns.length}건\n${warns.map((w) => `  ⚠ ${w}`).join("\n")}` : "\n## 경고 없음");
    }
  } finally {
    c.release();
    await pool.end();
  }
  if (warns.length && process.argv.includes("--strict")) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
