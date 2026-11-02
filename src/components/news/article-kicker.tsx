import { cn } from "@/lib/utils";
import { getCategoryLabel, getSourceName } from "@/lib/news-utils";
import { isScopeCategory } from "@/lib/categories";
import { regionBadgeLabel, regionBadges, regionLabel } from "@/lib/region";

interface ArticleKickerProps {
  category: string | null;
  sourceName: string | null;
  locale: string;
  /** 대상 지역 (subject_region). 있으면 매체명 앞에 "미국 · 36氪" 처럼 붙는다 */
  region?: string | null;
  /** 지역 태그 — '미중'·'한국' 작은 글자 배지 (src/lib/region.ts regionBadges) */
  regionTags?: string[] | null;
  className?: string;
}

/**
 * 제목 위 한 줄 메타: 카테고리 텍스트 라벨 + (대상 지역 · ) 원어 매체명 + 미중/한국 글자 배지.
 * 색 배지/국기/감성 점 대신 글자만 쓴다. 포인트 색(jade)은 범위 내(AI) 분류에만 준다(categories.ts).
 * 카드·리스트·관련 기사·상세·모달이 모두 이 컴포넌트를 쓴다.
 */
export function ArticleKicker({ category, sourceName, locale, region, regionTags, className }: ArticleKickerProps) {
  const source = getSourceName(sourceName);
  if (!category && !source) return null;
  const isOriginalName = !!source && source !== sourceName;
  const place = regionLabel(region, locale);
  const badges = regionBadges(region, regionTags);

  return (
    <p className={cn("flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-xs leading-snug", className)}>
      {category && (
        <span className={isScopeCategory(category) ? "font-semibold text-jade" : "font-medium text-ink-2"}>
          {getCategoryLabel(category, locale)}
        </span>
      )}
      {(place || source) && (
        <span className="text-ink-3">
          {place && (
            <span data-testid="kicker-region" data-region={region ?? undefined}>
              {place}
              {source && <span aria-hidden="true"> · </span>}
            </span>
          )}
          {source && <span lang={isOriginalName ? "zh-CN" : undefined}>{source}</span>}
        </span>
      )}
      {badges.map((b) => (
        // 국기 대신 글자 배지 — 괘선 테두리만, 색 없음
        <span
          key={b}
          data-testid="region-badge"
          data-badge={b}
          className="rounded-[2px] border border-rule px-[3px] text-[11px] font-semibold leading-[1.35] text-ink-2"
        >
          {regionBadgeLabel(b, locale)}
        </span>
      ))}
    </p>
  );
}
