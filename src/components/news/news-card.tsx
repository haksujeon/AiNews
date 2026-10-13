"use client";

import { useLocale } from "next-intl";
import { Calendar } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { Badge } from "@/components/ui/badge";
import type { NewsItem } from "@/lib/supabase";
import {
  getCountryLabel,
  formatDate,
  getTitle,
  getSummary,
  getCategoryStyle,
  getCategoryLabel,
  getSentimentStyle,
  getSentimentLabel,
} from "@/lib/news-utils";
import { NewsThumbnail } from "./news-thumbnail";

interface NewsCardProps {
  item: NewsItem;
}

const CATEGORY_COLORS: Record<string, string> = {
  "ai-tech": "from-cyan-500 to-cyan-400",
  "ai-product": "from-blue-500 to-blue-400",
  "ai-biz": "from-violet-500 to-violet-400",
  politics: "from-red-500 to-red-400",
  economy: "from-amber-500 to-amber-400",
  society: "from-emerald-500 to-emerald-400",
  culture: "from-pink-500 to-pink-400",
  tech: "from-orange-500 to-orange-400",
};

/**
 * 기사 카드. 실제 링크(/[locale]/news/[id])라서 탭 이동·새 탭 열기·주소 공유가 된다.
 * 소프트 이동이면 @modal/(.)news/[id] 가로채기 라우트가 모달로 열고,
 * 직접 접속/새로고침이면 전체 상세 페이지가 렌더된다. (목록/리스트/관련기사 모두 같은 경로)
 */
export function NewsCard({ item }: NewsCardProps) {
  const locale = useLocale();
  const title = getTitle(item, locale);
  const summary = getSummary(item, locale);
  const imageUrl = item.thumbnail_url || item.og_image_url;
  const catStyle = getCategoryStyle(item.category);
  const sentStyle = getSentimentStyle(item.sentiment);
  const stripeGradient = CATEGORY_COLORS[item.category || ""] || "from-gray-500 to-gray-400";

  return (
    <Link
      href={`/news/${item.id}`}
      prefetch={false}
      // 모달(가로채기 라우트)로 열 때 배경 목록의 스크롤 위치를 유지한다.
      scroll={false}
      className="block h-full cursor-pointer group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <article className="relative h-full rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm overflow-hidden transition-all duration-300 hover:border-primary/30 hover:bg-card/80 hover:shadow-[0_8px_30px_-12px_oklch(0.78_0.14_210/20%)]">
        {/* Category color stripe */}
        <div className={`h-0.5 bg-gradient-to-r ${stripeGradient}`} />

        {/* Image (깨지면 카테고리 플레이스홀더로 대체) */}
        <NewsThumbnail
          src={imageUrl}
          alt={title}
          category={item.category}
          className="h-44"
          imageClassName="object-cover group-hover:scale-[1.03] transition-transform duration-500 ease-out"
          sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, (max-width: 1280px) 33vw, 25vw"
        >
          <div className="absolute inset-0 bg-gradient-to-t from-card/60 via-transparent to-transparent" />
        </NewsThumbnail>

        {/* Content */}
        <div className="p-4 space-y-3">
          {/* Badges row */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              {item.country && (
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-secondary/50">
                  {getCountryLabel(item.country)}
                </Badge>
              )}
              {item.category && (
                <Badge
                  variant="outline"
                  className={`text-[10px] px-1.5 py-0 ${catStyle.text} border-current/20`}
                >
                  {getCategoryLabel(item.category, locale)}
                </Badge>
              )}
            </div>
            {item.sentiment && (
              <div className="flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${sentStyle.dot}`} />
                <span className={`text-[10px] ${sentStyle.text}`}>
                  {getSentimentLabel(item.sentiment, locale)}
                </span>
              </div>
            )}
          </div>

          {/* Title */}
          <h2 className="font-display text-base font-semibold leading-snug line-clamp-2 group-hover:text-primary transition-colors duration-200">
            {title}
          </h2>

          {/* Summary */}
          {summary && (
            <p className="text-xs text-muted-foreground leading-relaxed line-clamp-2">
              {summary}
            </p>
          )}

          {/* Footer */}
          <div className="flex items-center gap-3 text-[10px] text-muted-foreground/70 pt-1">
            {item.news_date && (
              <span className="flex items-center gap-1">
                <Calendar className="w-2.5 h-2.5" />
                {formatDate(item.news_date, locale)}
              </span>
            )}
            {item.source_name && (
              <span className="truncate">{item.source_name}</span>
            )}
          </div>
        </div>
      </article>
    </Link>
  );
}
