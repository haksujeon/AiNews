/**
 * 공개 분류(=서비스 범위) 단일 정의 (P0-5, Gate 2).
 *
 * 이 목록 하나가 다음을 모두 정한다.
 *  - 목록 필터 칩(fetchNewsFacets 는 이 목록과 DB 분류의 교집합만 낸다)
 *  - parseFilters 가 받아 주는 분류 값 (그 밖의 값은 버린다)
 *  - "범위 내(AI) 기사" 모집단: 브리핑 후보(briefing/repository), 주간·월간 지표 population 'ai'
 *    와 통계 KPI 의 AI 비율(metrics/period), 키커 강조색(article-kicker)
 *    — 예전의 `category LIKE 'ai-%'` 와 isAiCategory 를 대신한다.
 *
 * 비 AI 분류(economy·tech·society·culture) 기사 자체를 숨기지는 않는다. 목록 노출은 is_hidden 이 맡는다.
 *
 * 숨김 분류(HIDDEN_CATEGORIES, 로봇 범위 2단계): 범위에는 들어 있어도 "노출"만 막는 목록.
 *  - 노출 = 필터 칩(facets)·parseFilters·분류 RSS 피드(FEED_CATEGORIES, 정적 경로 포함) → VISIBLE_CATEGORIES 를 쓴다.
 *  - 범위 = 브리핑 후보·지표 모집단·키커 강조색 → SCOPE_CATEGORIES 를 그대로 쓴다(숨김과 무관).
 *  - 기사 자체(목록 "전체"·상세·sitemap 기사 항목)는 숨기지 않는다. sitemap 에는 분류 URL 이 없다.
 *  - 값: 빌드 시 환경변수 NEXT_PUBLIC_HIDDEN_CATEGORIES (쉼표 구분). 설정하지 않으면 기본 "robotics",
 *    빈 문자열("")이면 숨김 없음. 이 파일은 클라이언트 번들에도 들어가므로 NEXT_PUBLIC_ 이어야
 *    서버(parseFilters·facets)와 브라우저가 같은 목록을 본다. 바꾸면 다시 빌드한다.
 *
 * 로봇 분류 공개(결정 D10, 로봇 범위 검토 v3 승인 뒤) — 두 단계로 나눈다:
 *  1. 범위에 넣기(3단계 백필과 같이): 아래 배열에 `{ code: "robotics" }` 한 줄. 숨김 기본값 덕에 칩·피드는 아직 안 열린다.
 *     - 범위 모집단이 바뀌므로 metrics/period.ts 의 METRICS_VERSION 을 올리고 리포트 스냅숏을 다시 계산한다.
 *  2. 칩 공개(4단계): NEXT_PUBLIC_HIDDEN_CATEGORIES="" 로 빌드.
 *  - 라벨은 news-utils.ts CATEGORY_LABELS 에 이미 있다(로봇 / Robotics / 机器人). 순위 가중은 news-rank.ts CATEGORY_WEIGHT.robotics.
 *
 * 이 파일은 클라이언트 번들에도 들어간다(news-query → supabase-client). pg·node:* 를 import 하지 말 것.
 */

export interface PublicCategory {
  /** ai_news_ex.category 값 */
  code: string;
}

/** 공개 분류. 배열 순서 = 필터 칩 순서 */
export const PUBLIC_CATEGORIES: readonly PublicCategory[] = [
  { code: "ai-tech" },
  { code: "ai-product" },
  { code: "ai-biz" },
];

const CODE_RE = /^[a-z0-9-]+$/;
for (const c of PUBLIC_CATEGORIES) {
  // scopeCategorySql 이 값을 SQL 리터럴로 넣으므로 형식을 강제한다
  if (!CODE_RE.test(c.code)) throw new Error(`잘못된 분류 코드: ${c.code}`);
}

/** 범위 내 분류 코드 (공개 분류와 같은 목록) */
export const SCOPE_CATEGORIES: readonly string[] = PUBLIC_CATEGORIES.map((c) => c.code);

const SCOPE_SET: ReadonlySet<string> = new Set(SCOPE_CATEGORIES);

/** 숨김 분류 기본값 (환경변수를 설정하지 않았을 때) */
export const DEFAULT_HIDDEN_CATEGORIES = "robotics";

/** 숨김 분류 문자열 → 집합. undefined = 기본값, "" = 숨김 없음. 형식이 틀린 코드는 버린다 */
export function parseHiddenCategories(raw: string | undefined): ReadonlySet<string> {
  const v = raw === undefined ? DEFAULT_HIDDEN_CATEGORIES : raw;
  return new Set(v.split(",").map((c) => c.trim()).filter((c) => CODE_RE.test(c)));
}

/** 범위 분류 중 노출할 것 (순서 유지). 순수 함수 — 단위 테스트가 robotics 를 넣은 범위로 부른다 */
export function visibleCategoriesOf(scope: readonly string[], hidden: ReadonlySet<string>): string[] {
  return scope.filter((c) => !hidden.has(c));
}

// process.env.NEXT_PUBLIC_* 는 이 모양 그대로 써야 빌드 때 값이 박힌다(구조 분해·동적 키 금지)
export const HIDDEN_CATEGORIES: ReadonlySet<string> = parseHiddenCategories(process.env.NEXT_PUBLIC_HIDDEN_CATEGORIES);

/** 노출 분류 = 범위 분류 − 숨김 분류. 필터 칩·parseFilters·분류 피드가 쓴다 */
export const VISIBLE_CATEGORIES: readonly string[] = visibleCategoriesOf(SCOPE_CATEGORIES, HIDDEN_CATEGORIES);

const VISIBLE_SET: ReadonlySet<string> = new Set(VISIBLE_CATEGORIES);

/** 공개(노출) 분류인지: 필터 값으로 받아 주는지. 숨김 분류는 false */
export function isPublicCategory(category: string | null | undefined): category is string {
  return !!category && VISIBLE_SET.has(category);
}

/** 범위 내(AI, 이후 로봇 포함) 분류인지. 숨김 여부와 무관하다(브리핑·지표·키커) */
export function isScopeCategory(category: string | null | undefined): category is string {
  return !!category && SCOPE_SET.has(category);
}

const COLUMN_RE = /^[a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?$/;

/**
 * 범위 내 분류 SQL 조건. 값은 위에서 형식을 검사한 상수라 플레이스홀더 없이 리터럴로 넣는다
 * (populationWhere 처럼 다른 조건과 문자열로 이어 붙이는 곳에서 번호를 밀지 않도록).
 * @param column 분류 컬럼 (기본 category, 별칭 허용: n.category)
 */
export function scopeCategorySql(column = "category"): string {
  if (!COLUMN_RE.test(column)) throw new Error(`잘못된 컬럼 이름: ${column}`);
  return `${column} IN (${SCOPE_CATEGORIES.map((c) => `'${c}'`).join(", ")})`;
}

/** 필터 칩: DB 에 있는 분류 중 노출 분류만(숨김 제외), PUBLIC_CATEGORIES 순서로 */
export function publicCategoriesOf(present: Iterable<string>): string[] {
  const have = new Set(present);
  return VISIBLE_CATEGORIES.filter((c) => have.has(c));
}
