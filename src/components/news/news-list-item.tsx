"use client";

import { useLocale } from "next-intl";
import { Calendar, ArrowRight } from "lucide-react";
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

interface NewsListItemProps {
  item: NewsItem;
}

/** 리스트 보기용 기사 항목. NewsCard 와 같은 링크(/news/[id]) — 모달/전체페이지 동작 동일. */
export function NewsListItem({ item }: NewsListItemProps) {
  const locale = useLocale();
  const title = getTitle(item, locale);
  const summary = getSummary(item, locale);
  const imageUrl = item.thumbnail_url || item.og_image_url;
  const catStyle = getCategoryStyle(item.category);
  const sentStyle = getSentimentStyle(item.sentiment);

  return (
    <Link
      href={`/news/${item.id}`}
      prefetch={false}
      className="block cursor-pointer group rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <article className="rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm overflow-hidden transition-all duration-300 hover:border-primary/30 hover:bg-card/80">
        <div className="flex flex-col sm:flex-row">
          <NewsThumbnail
            src={imageUrl}
            alt={title}
            category={item.category}
            className="sm:w-52 h-44 sm:h-auto flex-shrink-0"
            imageClassName="object-cover group-hover:scale-[1.03] transition-transform duration-500"
            sizes="(max-width: 640px) 100vw, 208px"
          />

          <div className="flex-1 p-4 flex flex-col justify-between gap-2">
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                {item.country && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-secondary/50">
                    {getCountryLabel(item.country)}
                  </Badge>
                )}
                {item.category && (
                  <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${catStyle.text} border-current/20`}>
                    {getCategoryLabel(item.category, locale)}
                  </Badge>
                )}
                {item.sentiment && (
                  <span className="flex items-center gap-1">
                    <span className={`w-1.5 h-1.5 rounded-full ${sentStyle.dot}`} />
                    <span className={`text-[10px] ${sentStyle.text}`}>{getSentimentLabel(item.sentiment, locale)}</span>
                  </span>
                )}
              </div>

              <h2 className="font-display text-lg font-semibold leading-snug group-hover:text-primary transition-colors">
                {title}
              </h2>

              {summary && (
                <p className="text-sm text-muted-foreground line-clamp-2 leading-relaxed">
                  {summary}
                </p>
              )}
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3 text-[10px] text-muted-foreground/70">
                {item.news_date && (
                  <span className="flex items-center gap-1">
                    <Calendar className="w-2.5 h-2.5" />
                    {formatDate(item.news_date, locale)}
                  </span>
                )}
                {item.source_name && <span>{item.source_name}</span>}
              </div>
              <ArrowRight className="w-4 h-4 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
            </div>
          </div>
        </div>
      </article>
    </Link>
  );
}
