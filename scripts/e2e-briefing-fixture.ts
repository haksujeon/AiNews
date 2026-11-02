/**
 * e2e 브리핑 시험 데이터 만들기 — 공유 DB 에 아무것도 쓰지 않는다 (READ ONLY 트랜잭션 안에서 SELECT 만, 끝나면 ROLLBACK).
 *
 *   npx tsx --env-file=.env.local scripts/e2e-briefing-fixture.ts [출력 경로=e2e/.fixtures/briefings.json]
 *   AINEWS_E2E_BRIEFING_FIXTURE=$PWD/e2e/.fixtures/briefings.json npx next start -p 3089
 *
 * 최근 기사 날짜에서 역할별 날짜를 골라, 그 날짜의 초안(없으면 그날 기사로 만든 짧은 판)을 "발행본" 으로 적는다.
 * 서버는 src/lib/briefing/fixture.ts 이음매로 daily_briefings 대신 이 파일을 읽는다(기사는 DB 그대로).
 *
 * 역할 (e2e/day-briefing.spec.ts 가 roles 를 읽는다):
 *  - today      : 가장 최근 데이터 날짜. 판 없음 → 마감 전이면 "발행 예정"
 *  - weekendSat : 토요일 합본(토~일) ko·en·zh 발행 → 토·일 두 묶음이 같은 판으로 연결
 *  - koDay      : 평일 ko·zh 발행 (en 없음)
 *  - enOnlyDay  : 평일 en 만 발행 → ko 화면에서는 링크 없음 (결정 1)
 *  - page2Day   : 첫 화면(5일) 밖 평일 ko 발행 → 무한 스크롤로 받은 날에도 링크
 *  - withdrawnDay : ko 철회본만 → 팝업 주소로 열면 정정 안내
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import pool from "../src/lib/db";
import { PUBLIC_NEWS_WHERE } from "../src/lib/news-query";
import { editionPeriod, weekday } from "../src/lib/briefing/sla";
import { NEWS_DAYS_PER_PAGE } from "../src/lib/news-types";
import type { BriefingFixtureFile, FixtureBriefingRow } from "../src/lib/briefing/fixture";
import type { BriefingLocale, StoredBriefingContent } from "../src/lib/briefing/types";

const out = resolve(process.argv[2] ?? "e2e/.fixtures/briefings.json");

async function main() {
  const c = await pool.connect();
  try {
    await c.query("BEGIN READ ONLY");
    const { rows: dayRows } = await c.query(
      `SELECT to_char(news_date AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS d FROM ai_news_ex
        WHERE ${PUBLIC_NEWS_WHERE} GROUP BY 1 ORDER BY 1 DESC LIMIT 16`
    );
    const days: string[] = dayRows.map((r) => r.d);
    const page1 = days.slice(0, NEWS_DAYS_PER_PAGE);
    const page2 = days.slice(NEWS_DAYS_PER_PAGE, NEWS_DAYS_PER_PAGE * 2);
    const used = new Set<string>([days[0]]);
    const isWeekday = (d: string) => weekday(d) >= 1 && weekday(d) <= 5;
    const take = (cands: string[], ok: (d: string) => boolean) => {
      const d = cands.find((x) => !used.has(x) && ok(x));
      if (!d) throw new Error("날짜 역할을 고르지 못했습니다");
      used.add(d);
      return d;
    };
    const weekendSat = take([...page1, ...page2], (d) => weekday(d) === 6);
    used.add(editionPeriod(weekendSat).periodEnd);
    const koDay = take([...page1, ...page2], isWeekday);
    const enOnlyDay = take([...page1, ...page2], isWeekday);
    const page2Day = take(page2, isWeekday);
    const withdrawnDay = take([...page2, ...days.slice(NEWS_DAYS_PER_PAGE * 2)], isWeekday);
    const roles = { today: days[0], weekendSat, koDay, enOnlyDay, page2Day, withdrawnDay };

    /** 그 날짜·언어의 생성된 본문 (최신 버전). 없으면 같은 날짜 ko, 그것도 없으면 그날 기사로 만든 짧은 판 */
    async function contentFor(date: string, locale: BriefingLocale): Promise<{ content: StoredBriefingContent; article_ids: string[] }> {
      for (const loc of [locale, "ko"]) {
        const { rows } = await c.query(
          `SELECT content, article_ids FROM daily_briefings
            WHERE edition_type = 'daily' AND edition_date = $1::date AND locale = $2
              AND content ? 'top_stories' AND jsonb_array_length(content->'top_stories') > 0
            ORDER BY version DESC LIMIT 1`,
          [date, loc]
        );
        if (rows[0]) return { content: rows[0].content, article_ids: rows[0].article_ids ?? [] };
      }
      const p = editionPeriod(date);
      const { rows: arts } = await c.query(
        `SELECT id, COALESCE(title_kr, title_cn, '') AS title, COALESCE(summary_kr, '') AS summary FROM ai_news_ex
          WHERE ${PUBLIC_NEWS_WHERE}
            AND news_date >= ($1::date)::timestamp AT TIME ZONE 'UTC' AND news_date < ($2::date + 1)::timestamp AT TIME ZONE 'UTC'
          ORDER BY id LIMIT 3`,
        [p.periodStart, p.periodEnd]
      );
      const ids = arts.map((a) => a.id as string);
      const content = {
        headline: `[시험] ${arts[0]?.title ?? date}`,
        lede: arts[0]?.summary ?? "",
        lede_refs: ids.slice(0, 1),
        top_stories: arts.map((a, i) => ({ rank: i + 1, section: "industry", title: a.title, what: a.summary, why: "", refs: [a.id], primary_ref: a.id })),
        sections: [],
        key_numbers: [],
        companies_to_watch: [],
        term_of_the_day: null,
        clusters: [],
        excluded: [],
        meta: {
          edition_date: date,
          locale,
          mode: "short",
          candidate_count: ids.length,
          group_count: ids.length,
          cited_count: ids.length,
          china_centric_count: 0,
          prompt_version: "e2e-fixture",
          ai_generated: true,
        },
      } as unknown as StoredBriefingContent;
      return { content, article_ids: ids };
    }

    const now = new Date().toISOString();
    const rows: FixtureBriefingRow[] = [];
    let n = 0;
    async function add(date: string, locale: BriefingLocale, status: "published" | "withdrawn") {
      const p = editionPeriod(date);
      const { content, article_ids } = await contentFor(date, locale);
      rows.push({
        id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
        edition_type: "daily",
        edition_date: date,
        period_start: p.periodStart,
        period_end: p.periodEnd,
        locale,
        version: 1,
        status,
        mode: content.meta?.mode ?? "normal",
        published_at: now,
        needs_review: false,
        content,
        article_ids,
      });
    }
    for (const l of ["ko", "en", "zh"] as const) await add(weekendSat, l, "published");
    await add(koDay, "ko", "published");
    await add(koDay, "zh", "published");
    await add(enOnlyDay, "en", "published");
    await add(page2Day, "ko", "published");
    await add(withdrawnDay, "ko", "withdrawn");

    const file: BriefingFixtureFile = { roles, rows };
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(file, null, 1));
    console.log(`fixture: ${out}`);
    console.log(roles);
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    c.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
