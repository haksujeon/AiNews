import { cn } from "@/lib/utils";
import { getCategoryLabel, getSourceName, isAiCategory } from "@/lib/news-utils";

interface ArticleKickerProps {
  category: string | null;
  sourceName: string | null;
  locale: string;
  className?: string;
}

/**
 * 제목 위 한 줄 메타: 카테고리 텍스트 라벨 + 원어 매체명.
 * 색 배지/국기/감성 점 대신 글자만 쓴다. 포인트 색(jade)은 AI 카테고리에만 준다.
 * 카드·리스트·관련 기사·상세·모달이 모두 이 컴포넌트를 쓴다.
 */
export function ArticleKicker({ category, sourceName, locale, className }: ArticleKickerProps) {
  const source = getSourceName(sourceName);
  if (!category && !source) return null;
  const isOriginalName = !!source && source !== sourceName;

  return (
    <p className={cn("flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-xs leading-snug", className)}>
      {category && (
        <span className={isAiCategory(category) ? "font-semibold text-jade" : "font-medium text-ink-2"}>
          {getCategoryLabel(category, locale)}
        </span>
      )}
      {source && (
        <span className="text-ink-3" lang={isOriginalName ? "zh-CN" : undefined}>
          {source}
        </span>
      )}
    </p>
  );
}
