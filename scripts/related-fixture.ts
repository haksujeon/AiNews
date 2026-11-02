/**
 * 관련 기사 라벨 평가용 말뭉치 고정본 만들기 (읽기 전용 DB).
 *   npx tsx --env-file=.env.local scripts/related-fixture.ts
 * → tests/fixtures/related-corpus.json.br : 라벨 기준 기사(tests/fixtures/related-labels.json)들의 ±90일 창 안 공개 기사,
 *   rankRelated 가 읽는 필드만 (RELATED_DOC_FIELDS). tests/news/related-eval.test.ts 가 DB 없이 이 파일로 p@5 를 잰다.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brotliCompressSync, constants } from "node:zlib";
import pool from "../src/lib/db";
import { PUBLIC_NEWS_WHERE } from "../src/lib/news-query";
import { RELATED_DOC_FIELDS, RELATED_WINDOW_DAYS } from "../src/lib/related";

async function main() {
  const fx = JSON.parse(readFileSync(join(__dirname, "../tests/fixtures/related-labels.json"), "utf8")) as { seeds: string[] };
  const { rows: r } = await pool.query(
    `SELECT min(news_date AT TIME ZONE 'UTC')::date::text AS lo, max(news_date AT TIME ZONE 'UTC')::date::text AS hi
       FROM ai_news_ex WHERE id = ANY($1::uuid[])`,
    [fx.seeds]
  );
  const { rows } = await pool.query(
    `SELECT ${RELATED_DOC_FIELDS} FROM ai_news_ex
      WHERE (${PUBLIC_NEWS_WHERE} OR id = ANY($4::uuid[]))
        AND news_date >= ($1::date - $3::int)::timestamp AT TIME ZONE 'UTC'
        AND news_date <  ($2::date + $3::int + 1)::timestamp AT TIME ZONE 'UTC'
      ORDER BY id`,
    [r[0].lo, r[0].hi, RELATED_WINDOW_DAYS, fx.seeds]
  );
  const out = join(__dirname, "../tests/fixtures/related-corpus.json.br");
  const body = { _about: `ai_news_ex 공개 기사 ${r[0].lo}±${RELATED_WINDOW_DAYS}일 ~ ${r[0].hi}±${RELATED_WINDOW_DAYS}일, ${new Date().toISOString().slice(0, 10)} 기준`, docs: rows };
  writeFileSync(
    out,
    brotliCompressSync(JSON.stringify(body), { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_LGWIN]: 24 } })
  );
  console.log(`${rows.length} docs → ${out}`);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
