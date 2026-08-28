import pool from './db';
export type { NewsItem } from './news-types';
export { NEWS_PAGE_SIZE } from './news-types';
import type { NewsItem } from './news-types';
import { NEWS_PAGE_SIZE } from './news-types';
import { buildNewsWhere, EMPTY_FILTERS, type NewsFilters } from './news-query';

const LIST_FIELDS = `id,
  to_char(created_at::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at,
  source_name, source_url,
  to_char(news_date::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS news_date,
  title_cn, title_kr, title_en, summary_cn, summary_kr, summary_en,
  sentiment, category, thumbnail_url, og_image_url, country`;

const STATS_FIELDS = `${LIST_FIELDS}, key_terms`;

const DETAIL_FIELDS = `${LIST_FIELDS},
  content_cn, content_kr, content_en,
  ai_insights_cn, ai_insights_kr, ai_insights_en, key_terms`;

export interface NewsPage {
  items: NewsItem[];
  total: number;
}

/**
 * 필터가 적용된 뉴스 목록 한 페이지 + 필터 조건에 맞는 전체 건수.
 * total 이 있어야 UI가 "N건 중 30건 로드됨" 을 정확히 표시할 수 있다.
 */
export async function fetchNewsPage(
  filters: NewsFilters = EMPTY_FILTERS,
  offset = 0,
  limit: number = NEWS_PAGE_SIZE
): Promise<NewsPage> {
  const { where, values } = buildNewsWhere(filters);

  const [list, count] = await Promise.all([
    pool.query(
      `SELECT ${LIST_FIELDS} FROM ai_news_ex
       WHERE ${where}
       ORDER BY news_date DESC, id DESC
       OFFSET $${values.length + 1} LIMIT $${values.length + 2}`,
      [...values, offset, limit]
    ),
    pool.query(`SELECT COUNT(*)::int AS total FROM ai_news_ex WHERE ${where}`, values),
  ]);

  return { items: list.rows, total: count.rows[0]?.total ?? 0 };
}

/** 필터 드롭다운 선택지. 로드된 페이지가 아니라 테이블 전체에서 뽑는다. */
export async function fetchNewsFacets(): Promise<{
  countries: string[];
  categories: string[];
}> {
  const { rows } = await pool.query(
    `SELECT
       ARRAY(SELECT DISTINCT country  FROM ai_news_ex
             WHERE is_duplicate = FALSE AND country  IS NOT NULL ORDER BY country)  AS countries,
       ARRAY(SELECT DISTINCT category FROM ai_news_ex
             WHERE is_duplicate = FALSE AND category IS NOT NULL ORDER BY category) AS categories`
  );
  return {
    countries: rows[0]?.countries ?? [],
    categories: rows[0]?.categories ?? [],
  };
}

export async function fetchNewsList(): Promise<NewsItem[]> {
  const { items } = await fetchNewsPage();
  return items;
}

export async function fetchNewsForStats(): Promise<NewsItem[]> {
  const { rows } = await pool.query(
    `SELECT ${STATS_FIELDS} FROM ai_news_ex
     WHERE is_duplicate = FALSE
     ORDER BY news_date DESC
     LIMIT 1000`
  );
  return rows;
}

export async function fetchNewsById(id: string): Promise<NewsItem | null> {
  const { rows } = await pool.query(
    `SELECT ${DETAIL_FIELDS} FROM ai_news_ex WHERE id = $1 LIMIT 1`,
    [id]
  );
  return rows[0] ?? null;
}

export async function fetchRelatedNews(
  newsId: string,
  country: string | null,
  category: string | null
): Promise<NewsItem[]> {
  const values: unknown[] = [newsId];
  let sql = `SELECT ${LIST_FIELDS} FROM ai_news_ex
             WHERE id != $1 AND is_duplicate = FALSE`;
  if (country) {
    values.push(country);
    sql += ` AND country = $${values.length}`;
  }
  if (category) {
    values.push(category);
    sql += ` AND category = $${values.length}`;
  }
  sql += ` ORDER BY news_date DESC LIMIT 4`;

  const { rows } = await pool.query(sql, values);
  return rows;
}
