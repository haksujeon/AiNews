import { cn } from "@/lib/utils";
import { getCategoryLabel, getSourceName } from "@/lib/news-utils";
import { isScopeCategory } from "@/lib/categories";
import { regionBadgeLabel, regionBadges, regionLabel } from "@/lib/region";
import { RegionFlag } from "./region-flag";

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
 * 제목 위 한 줄 메타: 카테고리 텍스트 라벨 + (국기 대상 지역 · ) 원어 매체명 + 미중/한국 배지.
 * 2026-11-03 사용자 요청: 미국/중국 구분을 국기로 보여 준다 (글자 라벨은 그대로 — 국기는 장식, region-flag.tsx).
 * 포인트 색(jade)은 범위 내(AI) 분류에만 준다(categories.ts).
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
              {/* 국기·지역명만 묶는다 — 구분자 " · " 를 flex 안에 두면 끝 공백이 접힌다 */}
              <span className="inline-flex items-center gap-1 align-[-1px]">
                <RegionFlag code={region} />
                {place}
              </span>
              {source && <span aria-hidden="true"> · </span>}
            </span>
          )}
          {source && <span lang={isOriginalName ? "zh-CN" : undefined}>{source}</span>}
        </span>
      )}
      {badges.map((b) => (
        // 국기 + 글자 배지 — 괘선 테두리, 미중 = 미국·중국 국기 두 개
        <span
          key={b}
          data-testid="region-badge"
          data-badge={b}
          className="inline-flex items-center gap-[3px] rounded-[2px] border border-rule px-[3px] text-[11px] font-semibold leading-[1.35] text-ink-2"
        >
          {b === "us_china" ? (
            <>
              <RegionFlag code="US" />
              <RegionFlag code="CN" />
            </>
          ) : (
            <RegionFlag code="KR" />
          )}
          {regionBadgeLabel(b, locale)}
        </span>
      ))}
    </p>
  );
}
