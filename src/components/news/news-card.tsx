"use client";

import { useLocale } from "next-intl";
import Link from "next/link";
import { Calendar, ExternalLink, Globe } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { NewsItem } from "@/lib/supabase";
import { getCountryLabel, formatDate, getTitle, getSummary } from "@/lib/news-utils";

export function NewsCard({ item }: { item: NewsItem }) {
  const locale = useLocale();
  const title = getTitle(item, locale);
  const summary = getSummary(item, locale);
  const imageUrl = item.thumbnail_url || item.og_image_url;

  return (
    <Link href={`/news/${item.id}`}>
      <Card className="group h-full overflow-hidden transition-all duration-300 hover:shadow-lg hover:-translate-y-1 cursor-pointer">
        {imageUrl && (
          <div className="h-48 overflow-hidden bg-muted relative">
            <img
              src={imageUrl}
              alt={title}
              referrerPolicy="no-referrer"
              crossOrigin="anonymous"
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              onError={(e) => {
                const img = e.target as HTMLImageElement;
                const parent = img.parentElement!;
                img.style.display = "none";
                if (!parent.querySelector(".img-fallback")) {
                  const fallback = document.createElement("div");
                  fallback.className = "img-fallback absolute inset-0 flex items-center justify-center bg-muted text-muted-foreground text-sm";
                  fallback.textContent = "AI NEWS";
                  parent.appendChild(fallback);
                }
              }}
            />
          </div>
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
                <Badge variant="outline" className="text-xs capitalize">
                  {item.category}
                </Badge>
              )}
            </div>
            {item.sentiment && (
              <Badge
                variant="outline"
                className={
                  item.sentiment === "positive"
                    ? "text-green-600 border-green-300"
                    : item.sentiment === "negative"
                      ? "text-red-600 border-red-300"
                      : "text-gray-600"
                }
              >
                {item.sentiment === "positive"
                  ? "+"
                  : item.sentiment === "negative"
                    ? "-"
                    : "~"}
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
            <ExternalLink className="w-3.5 h-3.5" />
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
