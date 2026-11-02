/**
 * e2e 전용 브리핑 시험 데이터 (테스트 이음매).
 *
 * 공유 DB 에는 발행본을 쓰지 않는다. 대신 서버를 AINEWS_E2E_BRIEFING_FIXTURE=<json 경로> 로 띄우면
 * 공개 읽기 함수(public.ts)가 daily_briefings 대신 이 파일의 행을 읽는다. 기사(ai_news_ex)는 그대로 DB 에서 읽는다.
 * 파일은 scripts/e2e-briefing-fixture.ts 가 초안을 읽기 전용으로 조회해 만든다.
 *
 * 환경 변수가 없으면 null — 운영·개발 서버는 이 파일의 영향을 받지 않는다. NODE_ENV 로 막지 않는 이유:
 * e2e 는 `next start`(production) 로 돈다.
 */
import { readFileSync } from "node:fs";
import type { BriefingLocale, BriefingStatus, StoredBriefingContent } from "./types";

export const BRIEFING_FIXTURE_ENV = "AINEWS_E2E_BRIEFING_FIXTURE";

export interface FixtureBriefingRow {
  id: string;
  edition_type: "daily";
  edition_date: string;
  period_start: string;
  period_end: string;
  locale: BriefingLocale;
  version: number;
  status: BriefingStatus;
  mode: string;
  published_at: string | null;
  needs_review: boolean;
  content: StoredBriefingContent;
  article_ids: string[];
}

export interface BriefingFixtureFile {
  /** 시험이 쓰는 날짜 역할 (생성 스크립트가 고른다) */
  roles: Record<string, string>;
  rows: FixtureBriefingRow[];
}

/** 시험 데이터 행. 이음매가 꺼져 있으면 null. 요청마다 읽는다(작은 파일, e2e 전용) */
export function briefingFixtureRows(): FixtureBriefingRow[] | null {
  const path = process.env[BRIEFING_FIXTURE_ENV];
  if (!path) return null;
  const file = JSON.parse(readFileSync(path, "utf8")) as BriefingFixtureFile;
  return file.rows;
}
