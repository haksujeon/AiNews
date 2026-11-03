/**
 * "오늘" 홈(2026-11-03 메뉴 개편)의 LIVE 띠 — 마지막 수집 회차의 시각·건수와 최신 제목.
 * 모집단은 뉴스 목록과 같은 buildNewsWhere(EMPTY_FILTERS) (공개 조건·AI 범위 분류, Gate 2), 목록 필드도 같은 LIST_FIELDS.
 * 한 수집 회차(n8n 09·14·23시 KST)는 몇 분 안에 저장되므로 "마지막 저장 시각부터 2시간 안"을 한 회차로 본다.
 */
import pool from "./db";
import { buildNewsWhere, EMPTY_FILTERS } from "./news-query";
import { LIST_FIELDS } from "./news-fields";
import type { NewsItem } from "./news-types";

export const BATCH_WINDOW_HOURS = 2;

export interface LatestBatch {
  /** 마지막 수집 저장 시각 (ISO, UTC). 기사가 없으면 null */
  lastAt: string | null;
  /** 그 회차 기사 수 */
  count: number;
  /** 최신 기사 (저장 순) */
  items: NewsItem[];
}

export async function fetchLatestBatch(limit = 3): Promise<LatestBatch> {
  const { where, values } = buildNewsWhere(EMPTY_FILTERS);
  const n = values.length;
  const [{ rows: items }, { rows: agg }] = await Promise.all([
    pool.query(`SELECT ${LIST_FIELDS} FROM ai_news_ex WHERE ${where} ORDER BY created_at DESC LIMIT $${n + 1}`, [...values, limit]),
    pool.query(
      `WITH m AS (SELECT max(created_at) AS t FROM ai_news_ex WHERE ${where})
       SELECT to_char((SELECT t FROM m)::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS last_at,
              (SELECT count(*)::int FROM ai_news_ex WHERE ${where} AND created_at > (SELECT t FROM m) - make_interval(hours => $${n + 1})) AS count`,
      [...values, BATCH_WINDOW_HOURS]
    ),
  ]);
  return { lastAt: agg[0]?.last_at ?? null, count: agg[0]?.count ?? 0, items: items as NewsItem[] };
}

/** 공개 기사 총수 — 뉴스 목록 "총 N건"과 같은 모집단 (소개 페이지 숫자 띠) */
export async function fetchPublicTotal(): Promise<number> {
  const { where, values } = buildNewsWhere(EMPTY_FILTERS);
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ai_news_ex WHERE ${where}`, values);
  return rows[0]?.n ?? 0;
}
