"use client";

import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import {
  Calendar,
  ExternalLink,
  BookOpen,
  Lightbulb,
  Maximize2,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { NewsItem } from "@/lib/supabase";
import {
  formatDate,
  getTitle,
  getSummary,
  getCategoryStyle,
  getSentimentStyle,
  getSentimentLabel,
} from "@/lib/news-utils";
import { NewsPlaceholder } from "./news-placeholder";

interface NewsDetailModalProps {
  news: NewsItem;
}

export function NewsDetailModal({ news }: NewsDetailModalProps) {
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("detail");

  const title = getTitle(news, locale);
  const summary = getSummary(news, locale);
  const imageUrl = news.thumbnail_url || news.og_image_url;
  const catStyle = getCategoryStyle(news.category);
  const sentStyle = getSentimentStyle(news.sentiment);

  return (
    <Dialog
      defaultOpen
      onOpenChange={(open) => {
        if (!open) router.back();
      }}
    >
      <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-y-auto p-0 gap-0">
        {/* Hero image */}
        {imageUrl ? (
          <div className="relative w-full h-48 bg-muted overflow-hidden rounded-t-lg">
            <img
              src={imageUrl}
              alt={title}
              referrerPolicy="no-referrer"
              crossOrigin="anonymous"
              className="w-full h-full object-cover"
              onError={(e) => {
                const img = e.target as HTMLImageElement;
                img.style.display = "none";
                const parent = img.parentElement!;
                if (!parent.querySelector(".img-fallback")) {
                  const fallback = document.createElement("div");
                  fallback.className =
                    "img-fallback flex items-center justify-center h-full bg-muted text-muted-foreground";
                  fallback.textContent = "AI NEWS";
                  parent.appendChild(fallback);
                }
              }}
            />
          </div>
        ) : (
          <NewsPlaceholder category={news.category} className="h-48 rounded-t-lg rounded-b-none" />
        )}

        <div className="p-6 space-y-4">
          {/* Badges */}
          <div className="flex flex-wrap items-center gap-2">
            {news.category && (
              <Badge
                variant="outline"
                className={`capitalize ${catStyle.text} ${catStyle.border}`}
              >
                {news.category}
              </Badge>
            )}
            {news.sentiment && (
              <Badge
                variant="outline"
                className={`${sentStyle.text} ${sentStyle.border}`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${sentStyle.dot} mr-1.5`}
                />
                {getSentimentLabel(news.sentiment, locale)}
              </Badge>
            )}
          </div>

          {/* Title + metadata */}
          <DialogHeader className="text-left space-y-2">
            <DialogTitle className="text-xl leading-tight">
              {title}
            </DialogTitle>
            <DialogDescription asChild>
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                {news.news_date && (
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" />
                    {formatDate(news.news_date, locale)}
                  </span>
                )}
                {news.source_name && (
                  <span className="flex items-center gap-1">
                    <BookOpen className="w-3.5 h-3.5" />
                    {news.source_name}
                  </span>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>

          {/* AI Summary */}
          {summary && (
            <Card className="border-l-4 border-l-primary">
              <CardContent className="pt-4 pb-4">
                <p className="text-sm font-semibold text-primary mb-1.5">
                  {t("aiSummary")}
                </p>
                <p className="text-sm leading-relaxed">{summary}</p>
              </CardContent>
            </Card>
          )}

          {/* AI Insights (line-clamped) */}
          {news.ai_insights && (
            <div className="space-y-1.5">
              <p className="text-sm font-semibold flex items-center gap-1.5">
                <Lightbulb className="w-4 h-4 text-yellow-500" />
                {t("aiInsights")}
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed line-clamp-3">
                {news.ai_insights}
              </p>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 pt-2">
            <Link href={`/${locale}/news/${news.id}`}>
              <Button variant="default" size="sm">
                <Maximize2 className="w-4 h-4 mr-1.5" />
                {t("viewFullDetail")}
              </Button>
            </Link>
            {news.source_url && (
              <a
                href={news.source_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="outline" size="sm">
                  <ExternalLink className="w-4 h-4 mr-1.5" />
                  {t("viewOriginal")}
                </Button>
              </a>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
