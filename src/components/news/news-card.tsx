"use client";

import { useLocale } from "next-intl";
import Image from "next/image";
import { Calendar, Globe } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
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

interface NewsCardProps {
  item: NewsItem;
  onClick?: () => void;
}

export function NewsCard({ item, onClick }: NewsCardProps) {
  const locale = useLocale();
  const title = getTitle(item, locale);
  const summary = getSummary(item, locale);
  const imageUrl = item.thumbnail_url || item.og_image_url;
  const catStyle = getCategoryStyle(item.category);
  const sentStyle = getSentimentStyle(item.sentiment);

  return (
    <div onClick={onClick} className="cursor-pointer">
      <Card className="group h-full overflow-hidden transition-all duration-300 hover:shadow-lg hover:-translate-y-1">
        {imageUrl ? (
          <div className="h-48 overflow-hidden bg-muted relative">
            <Image
              src={imageUrl}
              alt={title}
              fill
              className="object-cover group-hover:scale-105 transition-transform duration-300"
              sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, (max-width: 1280px) 33vw, 25vw"
              referrerPolicy="no-referrer"
              unoptimized
            />
          </div>
        ) : (
          <NewsPlaceholder category={item.category} />
        )}
        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
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
            </div>
            {item.sentiment && (
              <Badge
                variant="outline"
                className={`${sentStyle.text} ${sentStyle.border}`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${sentStyle.dot} mr-1`}
                />
                {getSentimentLabel(item.sentiment, locale)}
              </Badge>
            )}
          </div>

          <h2 className="text-lg font-bold line-clamp-2 mb-2 group-hover:text-primary transition-colors">
            {title}
          </h2>

          {summary && (
            <p className="text-sm text-muted-foreground line-clamp-3 mb-4">
              {summary}
            </p>
          )}

          <div className="flex items-center justify-between text-xs text-muted-foreground mt-auto">
            <div className="flex items-center gap-3">
              {item.news_date && (
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3" />
                  {formatDate(item.news_date, locale)}
                </span>
              )}
              {item.source_name && <span>{item.source_name}</span>}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
