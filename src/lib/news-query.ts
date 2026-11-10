/**
 * 뉴스 목록 필터의 단일 진실 공급원(SQL).
 *
 * 이전에는 filterNews() 가 "브라우저에 이미 로드된 배열"만 걸렀다.
 * 5,093건 중 스크롤로 받은 30~180건 안에서만 검색되어, 사용자에게는
 * 검색이 고장난 것처럼 보였다. (2026-08-27 조사 P1-1)
 * 이제 모든 필터는 전체 테이블을 대상으로 SQL에서 처리한다.
 */
import { isPublicCategory } from "./categories";
import { parseRegionChip, regionChipSql, type RegionChip } from "./region";

export interface NewsFilters {
  q: string;
  country: string;      // "ALL" = 전체 (예전 국가 선택 — 화면에서는 지역 칩으로 바뀜, API 호환용)
  region: RegionChip;   // 대상 지역 칩: ALL · CN · US · OTHER (src/lib/region.ts)
  categories: string[]; // 빈 배열 = 전체
  from: string;         // YYYY-MM-DD, "" = 제한 없음
  to: string;           // YYYY-MM-DD, "" = 제한 없음
}

export const EMPTY_FILTERS: NewsFilters = {
  q: "",
  country: "ALL",
  region: "ALL",
  categories: [],
  from: "",
  to: "",
};

/**
 * 공개 화면(목록·필터 선택지·관련 기사·통계)에 노출되는 행의 기본 조건.
 *  - is_duplicate: 같은 기사의 중복 행
 *  - is_hidden: AI 와 무관한 기사 등 운영자가 숨긴 행 (2026-10-13 추가)
 * 숨긴 기사도 상세(/news/[id])는 예전 뉴스레터 링크 때문에 열리되 noindex 로 둔다.
 * 공개 집계 쿼리는 반드시 이 상수를 써서 조건이 어긋나지 않게 한다.
 */
export const PUBLIC_NEWS_WHERE = "is_duplicate = FALSE AND is_hidden = FALSE";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD 이면서 실제 달력 날짜인지 (2026-02-30·2026-13-45 는 false — DB 로 보내면 500) */
export function isCalendarDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const t = Date.parse(`${s}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

/** ILIKE 패턴 안에서 사용자 입력을 글자 그대로 (기본 이스케이프 문자 \) */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * URLSearchParams → NewsFilters (API 라우트와 클라이언트가 공유).
 * 분류는 공개 분류(categories.ts)만 받는다 — 예전 링크의 economy 등은 조용히 버려 전체로 본다.
 */
export function parseFilters(params: URLSearchParams): NewsFilters {
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";
  return {
    q: (params.get("q") ?? "").trim().slice(0, 100),
    country: (params.get("country") ?? "ALL").trim() || "ALL",
    region: parseRegionChip(params.get("region")),
    categories: (params.get("categories") ?? "")
      .split(",")
      .map((c) => c.trim())
      .filter((c) => isPublicCategory(c))
      .filter((c, i, a) => a.indexOf(c) === i),
    // 형식만이 아니라 실제 달력 날짜여야 한다 (2026-02-30 을 DB 로 보내면 500, QA B-04)
    from: isCalendarDate(from) ? from : "",
    to: isCalendarDate(to) ? to : "",
  };
}

/** NewsFilters → URLSearchParams (클라이언트가 요청을 만들 때) */
export function filtersToParams(filters: NewsFilters): URLSearchParams {
  const p = new URLSearchParams();
  if (filters.q) p.set("q", filters.q);
  if (filters.country && filters.country !== "ALL") p.set("country", filters.country);
  if (filters.region && filters.region !== "ALL") p.set("region", filters.region);
  if (filters.categories.length) p.set("categories", filters.categories.join(","));
  if (filters.from) p.set("from", filters.from);
  if (filters.to) p.set("to", filters.to);
  return p;
}

export function hasActiveFilters(f: NewsFilters): boolean {
  return Boolean(
    f.q || (f.country && f.country !== "ALL") || (f.region && f.region !== "ALL") || f.categories.length || f.from || f.to
  );
}

/**
 * 파라미터화된 WHERE 절을 만든다. 값은 전부 플레이스홀더로 넘어가므로
 * 사용자 입력이 SQL 로 이어붙지 않는다.
 *
 * @param startIndex 이미 사용 중인 플레이스홀더 개수 (다음 번호가 startIndex+1)
 */
export function buildNewsWhere(
  filters: NewsFilters,
  startIndex = 0
): { where: string; values: unknown[] } {
  const clauses = [PUBLIC_NEWS_WHERE];
  const values: unknown[] = [];
  let i = startIndex;

  if (filters.q) {
    // 검색은 UI 로케일과 무관하게 3개 언어 제목·요약 + 출처를 모두 훑는다.
    // "OpenAI" 를 한국어 화면에서 검색해도 찾히게 하려는 의도.
    i += 1;
    // % _ \ 는 ILIKE 와일드카드라 글자 그대로 찾도록 이스케이프한다 (QA B-06: "%" 만 넣으면 전체가 나왔다)
    values.push(`%${escapeLike(filters.q)}%`);
    clauses.push(`(
      title_kr ILIKE $${i} OR title_en ILIKE $${i} OR title_cn ILIKE $${i} OR
      summary_kr ILIKE $${i} OR summary_en ILIKE $${i} OR summary_cn ILIKE $${i} OR
      source_name ILIKE $${i}
    )`);
  }

  if (filters.country && filters.country !== "ALL") {
    i += 1;
    values.push(filters.country);
    clauses.push(`country = $${i}`);
  }

  // 지역 칩: 상수 조각만 붙는다(값은 parseRegionChip 이 네 가지로 제한)
  const regionClause = filters.region ? regionChipSql(filters.region) : null;
  if (regionClause) clauses.push(regionClause);

  if (filters.categories.length) {
    i += 1;
    values.push(filters.categories);
    clauses.push(`category = ANY($${i})`);
  }

  if (filters.from) {
    i += 1;
    values.push(filters.from);
    clauses.push(`news_date >= $${i}::date`);
  }

  if (filters.to) {
    i += 1;
    // to 는 그 날짜를 포함해야 하므로 다음 날 0시 미만으로 비교한다.
    values.push(filters.to);
    clauses.push(`news_date < ($${i}::date + interval '1 day')`);
  }

  return { where: clauses.join(" AND "), values };
}
