import pool from './db';
export type { NewsItem } from './news-types';
export { NEWS_PAGE_SIZE } from './news-types';
import type { NewsItem } from './news-types';
import { NEWS_PAGE_SIZE } from './news-types';

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

export async function fetchNewsList(): Promise<NewsItem[]> {
  const { rows } = await pool.query(
    `SELECT ${LIST_FIELDS} FROM ai_news_ex
     WHERE is_duplicate = FALSE
     ORDER BY news_date DESC, id DESC
     LIMIT $1`,
    [NEWS_PAGE_SIZE]
  );
  return rows;
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
