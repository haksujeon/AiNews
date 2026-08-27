"use client";

import { useLocale } from "next-intl";
import Image from "next/image";
import { Calendar } from "lucide-react";
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
import { NewsPlaceholder } from "./news-placeholder";

interface NewsCardProps {
  item: NewsItem;
  onClick?: () => void;
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

export function NewsCard({ item, onClick }: NewsCardProps) {
  const locale = useLocale();
  const title = getTitle(item, locale);
  const summary = getSummary(item, locale);
  const imageUrl = item.thumbnail_url || item.og_image_url;
  const catStyle = getCategoryStyle(item.category);
  const sentStyle = getSentimentStyle(item.sentiment);
  const stripeGradient = CATEGORY_COLORS[item.category || ""] || "from-gray-500 to-gray-400";

  return (
    <div onClick={onClick} className="cursor-pointer group">
      <article className="relative h-full rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm overflow-hidden transition-all duration-300 hover:border-primary/30 hover:bg-card/80 hover:shadow-[0_8px_30px_-12px_oklch(0.78_0.14_210/20%)]">
        {/* Category color stripe */}
        <div className={`h-0.5 bg-gradient-to-r ${stripeGradient}`} />

        {/* Image */}
        {imageUrl ? (
          <div className="h-44 overflow-hidden bg-muted/50 relative">
            <Image
              src={imageUrl}
              alt={title}
              fill
              className="object-cover group-hover:scale-[1.03] transition-transform duration-500 ease-out"
              sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, (max-width: 1280px) 33vw, 25vw"
              referrerPolicy="no-referrer"
              unoptimized
            />
            <div className="absolute inset-0 bg-gradient-to-t from-card/60 via-transparent to-transparent" />
          </div>
        ) : (
          <NewsPlaceholder category={item.category} className="h-44" />
        )}

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
    </div>
  );
}
