/**
 * 날짜 목록(홈)의 날짜 묶음 ↔ 데일리 판 고르기 (순수 함수, DB 없음 — 단위 테스트가 DATABASE_URL 없이 돈다).
 *
 * 홈 첫 화면(fetchNewsDays)과 무한 스크롤(/api/news/days)이 같은 loadDayBriefings → 이 함수들을 쓴다 (Gate 2).
 * 한 번 읽은 판 목록에서 두 가지를 고른다:
 *  - 순위용 판(pickRankEdition): "주요 4건" 의 브리핑 인용 우선 규칙. 언어는 보는 언어 → ko → 그 밖 순으로 대체한다
 *    (인용은 기사 id 라 언어판이 달라도 같은 뜻).
 *  - 링크용 판(pickLinkEdition): 날짜 옆 "그날 브리핑" 링크. 보는 언어판만 (다른 언어판만 있으면 링크 없음, 결정 1).
 *
 * 판이 날짜를 덮는 규칙: period_start ≤ 날짜 ≤ period_end. 토요일 합본(토~일)이 일요일 묶음도 덮는다.
 * 같은 언어 안에서는 판 날짜가 묶음 날짜와 정확히 같은 판을 먼저 쓴다(강제 재생성한 일요일 단독판 등).
 */
import type { BriefingLocale } from "./types";

export interface DayEditionRow {
  edition_date: string;
  period_start: string;
  period_end: string;
  locale: BriefingLocale | string;
  status: string;
  headline: string;
  /** content->'top_stories' 그대로 (순위 계산용) */
  top_stories: unknown;
}

/** 날짜 묶음의 링크 정보 (NewsDay.briefing) */
export interface DayBriefingRef {
  /** 연결할 판 날짜 (일요일 묶음이면 토요일 합본 날짜) */
  editionDate: string;
  /** 토·일 합본인가 */
  weekend: boolean;
  headline: string;
}

export function coversDay(row: Pick<DayEditionRow, "period_start" | "period_end">, day: string): boolean {
  return row.period_start <= day && day <= row.period_end;
}

/** 그 날짜를 덮는 발행본, 같은 날짜 판 먼저 (그 다음 판 날짜 최신 순) */
function covering(rows: DayEditionRow[], day: string): DayEditionRow[] {
  return rows
    .filter((r) => r.status === "published" && coversDay(r, day))
    .sort((a, b) => Number(b.edition_date === day) - Number(a.edition_date === day) || b.edition_date.localeCompare(a.edition_date));
}

/** 링크용: 보는 언어판만 */
export function pickLinkEdition(rows: DayEditionRow[], day: string, locale: string): DayEditionRow | null {
  return covering(rows, day).find((r) => r.locale === locale) ?? null;
}

/** 순위용: 보는 언어 → ko → 그 밖 언어(이름순). 같은 언어 안에서는 같은 날짜 판 먼저 */
export function pickRankEdition(rows: DayEditionRow[], day: string, locale: string): DayEditionRow | null {
  const tier = (l: string) => (l === locale ? 0 : l === "ko" ? 1 : 2);
  const c = covering(rows, day);
  // covering 의 순서(같은 날짜 먼저)를 언어 순위 안에서 지키도록 안정 정렬
  return [...c].sort((a, b) => tier(a.locale) - tier(b.locale) || (tier(a.locale) === 2 ? a.locale.localeCompare(b.locale) : 0))[0] ?? null;
}

export function toDayBriefingRef(row: DayEditionRow): DayBriefingRef {
  return { editionDate: row.edition_date, weekend: row.period_end > row.edition_date, headline: row.headline };
}
