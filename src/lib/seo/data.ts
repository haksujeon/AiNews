/**
 * sitemap·RSS 가 읽는 공개 기사 (서버 전용). 조건은 목록·관련 기사와 같은 PUBLIC_NEWS_WHERE (Gate 2):
 * 숨긴(is_hidden)·중복(is_duplicate) 기사는 sitemap·피드에 나오지 않는다.
 * 번역 전문(content_*)은 고르지 않는다 — 피드에는 제목·요약·링크만 싣는다.
 */
import pool from "@/lib/db";
import { PUBLIC_NEWS_WHERE } from "@/lib/news-query";
import type { NewsItem } from "@/lib/news-types";

/** sitemap 한 파일의 기사 수. 기사 하나가 언어 3개 URL 이라 한 파일 15,000 URL(한도 50,000) */
export const SITEMAP_ARTICLES_PER_FILE = 5000;

const ISO = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

export async function countPublicNews(): Promise<number> {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ai_news_ex WHERE ${PUBLIC_NEWS_WHERE}`);
  return rows[0]?.n ?? 0;
}

export interface SitemapNewsRow {
  id: string;
  lastmod: string | null;
}

/** 공개 기사 id·수정 시각. 정렬은 오래된 순(파일 경계가 새 기사로 흔들리지 않게) */
export async function listSitemapNews(chunk: number): Promise<SitemapNewsRow[]> {
  const { rows } = await pool.query(
    `SELECT id, ${ISO("GREATEST(created_at, news_date)")} AS lastmod
       FROM ai_news_ex WHERE ${PUBLIC_NEWS_WHERE}
      ORDER BY created_at ASC, id ASC OFFSET $1 LIMIT $2`,
    [chunk * SITEMAP_ARTICLES_PER_FILE, SITEMAP_ARTICLES_PER_FILE]
  );
  return rows as SitemapNewsRow[];
}

export type FeedNewsRow = Pick<
  NewsItem,
  "id" | "news_date" | "created_at" | "title_cn" | "title_kr" | "title_en" | "summary_cn" | "summary_kr" | "summary_en" | "category" | "source_name"
>;

/** 피드용 최신 공개 기사 (분류를 주면 그 분류만) */
export async function listFeedNews(limit: number, category?: string): Promise<FeedNewsRow[]> {
  const values: unknown[] = [limit];
  let where = PUBLIC_NEWS_WHERE;
  if (category) {
    values.push(category);
    where += ` AND category = $2`;
  }
  const { rows } = await pool.query(
    `SELECT id, ${ISO("news_date")} AS news_date, ${ISO("created_at")} AS created_at,
            title_cn, title_kr, title_en, summary_cn, summary_kr, summary_en, category, source_name
       FROM ai_news_ex WHERE ${where}
      ORDER BY news_date DESC NULLS LAST, created_at DESC LIMIT $1`,
    values
  );
  return rows as FeedNewsRow[];
}
