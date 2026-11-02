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
 * 로봇 분류 공개(결정 D10, 로봇 범위 검토 v3 승인 뒤): 아래 배열에 `{ code: "robotics" }` 한 줄을 넣는다.
 *  - 라벨은 news-utils.ts CATEGORY_LABELS 에 이미 있다(로봇 / Robotics / 机器人).
 *  - 범위 모집단이 바뀌므로 metrics/period.ts 의 METRICS_VERSION 을 올리고 리포트 스냅숏을 다시 계산한다.
 *  - 홈 순위 가중은 news-rank.ts CATEGORY_WEIGHT 에 robotics 를 넣는다(없으면 기본 0.5).
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

export function isPublicCategory(category: string | null | undefined): category is string {
  return !!category && SCOPE_SET.has(category);
}

/** 범위 내(AI, 이후 로봇 포함) 분류인지. 공개 분류와 같은 판정이다 */
export const isScopeCategory = isPublicCategory;

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

/** 필터 칩: DB 에 있는 분류 중 공개 분류만, PUBLIC_CATEGORIES 순서로 */
export function publicCategoriesOf(present: Iterable<string>): string[] {
  const have = new Set(present);
  return SCOPE_CATEGORIES.filter((c) => have.has(c));
}
