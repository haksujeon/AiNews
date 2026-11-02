/**
 * 관련 기사 미리 계산 (related_articles 채우기). 화면(findRelated)·upsert 와 같은 rankRelated·storeRanking 을 쓴다.
 *
 *   npx tsx --env-file=.env.local scripts/related-backfill.ts --days 60      # 최근 60일 공개 기사
 *   npx tsx --env-file=.env.local scripts/related-backfill.ts                # 공개 기사 전부
 *   npx tsx --env-file=.env.local scripts/related-backfill.ts --missing      # 계산 표시 행이 없는 기사만
 *
 * 필요한 기간(기준 기사 범위 ±90일)의 공개 기사를 한 번에 읽어 특징을 한 번만 뽑고, 기준 기사마다 그 창을 잘라 순위를 매긴다.
 * 기사당 DB 쓰기 1트랜잭션. 운영 중에 돌려도 된다(upsert 와 같은 방식이라 화면이 읽는 중에도 충돌하지 않는다).
 */
import pool from "../src/lib/db";
import { PUBLIC_NEWS_WHERE } from "../src/lib/news-query";
import { RELATED_DOC_FIELDS, RELATED_WINDOW_DAYS, rankRelated, storeRanking, type RelatedDoc } from "../src/lib/related";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const dayNum = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86_400_000);

async function main() {
  const days = arg("--days") ? Number(arg("--days")) : null;
  const missingOnly = process.argv.includes("--missing");
  const t0 = Date.now();

  const { rows: seeds } = await pool.query(
    `SELECT id::text, to_char(news_date AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day FROM ai_news_ex n
      WHERE ${PUBLIC_NEWS_WHERE} AND news_date IS NOT NULL
        ${days ? `AND news_date >= (now() AT TIME ZONE 'UTC')::date - ${Math.floor(days)}` : ""}
        ${missingOnly ? `AND NOT EXISTS (SELECT 1 FROM related_articles r WHERE r.news_id = n.id AND r.section = '_meta')` : ""}
      ORDER BY news_date, id`
  );
  if (!seeds.length) {
    console.log("기준 기사 없음");
    return;
  }
  const lo = seeds[0].day as string;
  const hi = seeds[seeds.length - 1].day as string;
  const { rows } = await pool.query(
    `SELECT ${RELATED_DOC_FIELDS} FROM ai_news_ex
      WHERE ${PUBLIC_NEWS_WHERE}
        AND news_date >= ($1::date - $3::int)::timestamp AT TIME ZONE 'UTC'
        AND news_date <  ($2::date + $3::int + 1)::timestamp AT TIME ZONE 'UTC'`,
    [lo, hi, RELATED_WINDOW_DAYS]
  );
  const docs = (rows as RelatedDoc[]).sort((a, b) => a.day.localeCompare(b.day) || a.id.localeCompare(b.id));
  const nums = docs.map((d) => dayNum(d.day));
  const byId = new Map(docs.map((d) => [d.id, d]));
  const tLoad = Date.now();
  console.log(`기준 기사 ${seeds.length}건 (${lo} ~ ${hi}), 후보 말뭉치 ${docs.length}건 읽음 ${tLoad - t0}ms`);

  const lowerBound = (x: number) => {
    let a = 0;
    let b = nums.length;
    while (a < b) {
      const m = (a + b) >> 1;
      if (nums[m] < x) a = m + 1;
      else b = m;
    }
    return a;
  };

  let done = 0;
  let rowsWritten = 0;
  let empty = 0;
  for (const s of seeds as { id: string; day: string }[]) {
    const seed = byId.get(s.id);
    if (!seed) continue;
    const c = dayNum(s.day);
    const window = docs.slice(lowerBound(c - RELATED_WINDOW_DAYS), lowerBound(c + RELATED_WINDOW_DAYS + 1));
    const ranking = rankRelated(seed, window);
    await storeRanking(seed.id, ranking);
    const n = ranking.sections.sameEvent.length + ranking.sections.flow.length + ranking.sections.company.length;
    rowsWritten += n;
    if (!n) empty++;
    done++;
    if (done % 200 === 0) console.log(`  ${done}/${seeds.length}  ${Math.round((Date.now() - tLoad) / done)}ms/건`);
  }
  const total = Date.now() - t0;
  console.log(
    `완료: ${done}건, 관련 행 ${rowsWritten} (기사당 평균 ${(rowsWritten / Math.max(1, done)).toFixed(1)}), 세 묶음 모두 빈 기사 ${empty}건, ` +
      `총 ${(total / 1000).toFixed(1)}초 (읽기 ${((tLoad - t0) / 1000).toFixed(1)}초, 기사당 ${Math.round((Date.now() - tLoad) / Math.max(1, done))}ms)`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
