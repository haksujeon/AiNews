"use client";

import { useLocale } from "next-intl";
import Link from "next/link";
import Image from "next/image";
import { Calendar, Globe } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { NewsItem } from "@/lib/supabase";
import {
  getCountryLabel,
  formatDate,
  getTitle,
  getSummary,
  getCategoryStyle,
  getSentimentStyle,
  getSentimentLabel,
} from "@/lib/news-utils";
import { NewsPlaceholder } from "./news-placeholder";

export function NewsListItem({ item }: { item: NewsItem }) {
  const locale = useLocale();
  const title = getTitle(item, locale);
  const summary = getSummary(item, locale);
  const imageUrl = item.thumbnail_url || item.og_image_url;
  const catStyle = getCategoryStyle(item.category);
  const sentStyle = getSentimentStyle(item.sentiment);

  return (
    <Link href={`/news/${item.id}`}>
      <article className="group bg-card rounded-xl border hover:shadow-lg transition-all duration-300 overflow-hidden cursor-pointer">
        <div className="flex flex-col sm:flex-row">
          {imageUrl ? (
            <div className="sm:w-56 h-48 sm:h-auto flex-shrink-0 overflow-hidden bg-muted relative">
              <Image
                src={imageUrl}
                alt={title}
                fill
                className="object-cover group-hover:scale-105 transition-transform duration-300"
                sizes="(max-width: 640px) 100vw, 224px"
                referrerPolicy="no-referrer"
                unoptimized
              />
            </div>
          ) : (
            <div className="sm:w-56 h-48 sm:h-auto flex-shrink-0">
              <NewsPlaceholder category={item.category} className="h-full" />
            </div>
          )}

          <div className="flex-1 p-5">
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              {item.country && (
                <Badge variant="secondary" className="text-xs">
                  <Globe className="w-3 h-3 mr-1" />
                  {getCountryLabel(item.country)}
                </Badge>
              )}
              {item.category && (
                <Badge
                  variant="outline"
                  className={`text-xs capitalize ${catStyle.text} ${catStyle.border}`}
                >
                  {item.category}
                </Badge>
              )}
              {item.sentiment && (
                <Badge
                  variant="outline"
                  className={`text-xs ${sentStyle.text} ${sentStyle.border}`}
                >
                  <span className={`w-1.5 h-1.5 rounded-full ${sentStyle.dot} mr-1`} />
                  {getSentimentLabel(item.sentiment, locale)}
                </Badge>
              )}
              {item.news_date && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {formatDate(item.news_date, locale)}
                </span>
              )}
              {item.source_name && (
                <span className="text-xs text-muted-foreground">
                  {item.source_name}
                </span>
              )}
            </div>

            <h2 className="text-xl font-bold mb-2 group-hover:text-primary transition-colors">
              {title}
            </h2>

            {summary && (
              <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                {summary}
              </p>
            )}

            <div className="flex items-center">
              <span className="text-sm text-primary font-medium">
                {locale === "ko" ? "상세보기" : locale === "zh" ? "查看详情" : "Read more"} →
              </span>
            </div>
          </div>
        </div>
      </article>
    </Link>
  );
}
