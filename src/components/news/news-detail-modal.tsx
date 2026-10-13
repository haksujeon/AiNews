"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Calendar,
  ExternalLink,
  BookOpen,
  Lightbulb,
  Loader2,
  Minus,
  Plus,
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { NewsItem } from "@/lib/supabase";
import { fetchNewsDetailClient, fetchRelatedNewsClient } from "@/lib/supabase-client";
import {
  formatDate,
  getTitle,
  getSummary,
  getContent,
  getAiInsights,
  getCategoryStyle,
  getCategoryLabel,
  getSentimentStyle,
  getSentimentLabel,
  getTermExplanation,
} from "@/lib/news-utils";
import { Link } from "@/i18n/navigation";
import { NewsPlaceholder } from "./news-placeholder";

interface NewsDetailModalProps {
  news: NewsItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// 가로채기 라우트(@modal/(.)news/[id])에서만 쓰인다. 카드/리스트/관련기사 클릭은 모두
// /news/[id] 링크 이동이며, 직접 접속 시에는 같은 데이터로 전체 페이지(NewsDetail)가 렌더된다.
export function NewsDetailModal({ news, open, onOpenChange }: NewsDetailModalProps) {
  const locale = useLocale();
  const t = useTranslations("detail");
  const [detail, setDetail] = useState<NewsItem | null>(null);
  const [relatedNews, setRelatedNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [relatedCount, setRelatedCount] = useState(2);

  useEffect(() => {
    // 관련 기사로 연속 이동할 때 늦게 도착한 이전 기사 응답이 덮어쓰지 않도록 한다.
    let cancelled = false;
    if (open && news) {
      setLoading(true);
      setError(false);
      Promise.all([
        fetchNewsDetailClient(news.id),
        fetchRelatedNewsClient(news.category, news.id, 4),
      ])
        .then(([detailData, related]) => {
          if (cancelled) return;
          setDetail(detailData);
          setRelatedNews(related);
        })
        .catch(() => {
          if (!cancelled) setError(true);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }
    if (!open) {
      setDetail(null);
      setRelatedNews([]);
      setError(false);
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, news?.id]);

  if (!news) return null;

  const fullItem = detail ?? news;
  const title = getTitle(fullItem, locale);
  const summary = getSummary(fullItem, locale);
  const content = getContent(fullItem, locale);
  const aiInsights = getAiInsights(fullItem, locale);
  const imageUrl = fullItem.thumbnail_url || fullItem.og_image_url;
  const catStyle = getCategoryStyle(fullItem.category);
  const sentStyle = getSentimentStyle(fullItem.sentiment);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[calc(100dvh-2rem)] sm:max-h-[85vh] overflow-y-auto p-0 gap-0 border-border/50 bg-card/95 backdrop-blur-xl">
        {/* Hero image */}
        {imageUrl ? (
          <div className="relative w-full h-36 sm:h-48 bg-muted overflow-hidden rounded-t-lg">
            <img
              src={imageUrl}
              alt={title}
              referrerPolicy="no-referrer"
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
          <NewsPlaceholder category={fullItem.category} className="h-36 sm:h-48 rounded-t-lg rounded-b-none" />
        )}

        <div className="p-4 sm:p-6 space-y-4">
          {/* Badges */}
          <div className="flex flex-wrap items-center gap-2">
            {fullItem.category && (
              <Badge
                variant="outline"
                className={`${catStyle.text} ${catStyle.border}`}
              >
                {getCategoryLabel(fullItem.category, locale)}
              </Badge>
            )}
            {fullItem.sentiment && (
              <Badge
                variant="outline"
                className={`${sentStyle.text} ${sentStyle.border}`}
              >
                <span
                  className={`w-2 h-2 rounded-full ${sentStyle.dot} mr-1.5`}
                />
                {getSentimentLabel(fullItem.sentiment, locale)}
              </Badge>
            )}
          </div>

          {/* Title + metadata */}
          <DialogHeader className="text-left space-y-2">
            <DialogTitle className="font-display text-xl sm:text-3xl font-bold leading-tight">
              {title}
            </DialogTitle>
            <DialogDescription asChild>
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                {fullItem.news_date && (
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" />
                    {formatDate(fullItem.news_date, locale)}
                  </span>
                )}
                {fullItem.source_name && (
                  <span className="flex items-center gap-1">
                    <BookOpen className="w-3.5 h-3.5" />
                    {fullItem.source_name}
                  </span>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">{t("loading")}</span>
            </div>
          ) : error ? (
            <div role="alert" className="flex flex-col items-center justify-center gap-1 py-8 text-center text-muted-foreground">
              <span className="text-sm">{t("loadError")}</span>
              <span className="text-xs text-muted-foreground/70">{t("loadErrorHint")}</span>
            </div>
          ) : (
            <>
              {/* 1. AI Summary */}
              {summary && (
                <Card className="border-l-4 border-l-blue-500 bg-blue-500/5 border-border/30">
                  <CardHeader className="pb-2 pt-4">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Lightbulb className="w-4 h-4 text-blue-500" />
                      {t("aiSummary")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pb-4">
                    <p className="text-sm leading-relaxed text-muted-foreground">{summary}</p>
                  </CardContent>
                </Card>
              )}

              {/* 2. News Content */}
              {content && (
                <Card className="border-l-4 border-l-emerald-500 bg-emerald-500/5 border-border/30">
                  <CardHeader className="pb-2 pt-4">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-emerald-500" />
                      {t("newsContent")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pb-4">
                    <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap line-clamp-12">
                      {content}
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* 3. AI Insights */}
              {aiInsights && (
                <Card className="border-l-4 border-l-amber-500 bg-amber-500/5 border-border/30">
                  <CardHeader className="pb-2 pt-4">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Lightbulb className="w-4 h-4 text-amber-500" />
                      {t("aiInsights")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pb-4">
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {aiInsights}
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Key terms */}
              {fullItem.key_terms && fullItem.key_terms.length > 0 && (
                <Card className="border-l-4 border-l-violet-500 bg-violet-500/5 border-border/30">
                  <CardHeader className="pb-2 pt-4">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-violet-500" />
                      {t("keyTerms")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pb-4">
                    <div className="space-y-3">
                      {fullItem.key_terms.map((term, index) => (
                        <div key={index} className="flex gap-3 items-start">
                          <div className="shrink-0 mt-0.5">
                            <Badge variant="secondary" className="text-xs">
                              {term.term}
                            </Badge>
                            {term.pinyin && (
                              <p className="text-[10px] text-muted-foreground/60 mt-0.5 pl-0.5">{term.pinyin}</p>
                            )}
                          </div>
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            {getTermExplanation(term, locale)}
                          </p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}

          {/* Action buttons */}
          {news.source_url && (
            <div className="flex flex-col items-start gap-2 pt-2">
              {!loading && !content && (
                <p className="text-sm text-muted-foreground">
                  {t("readFullAtSource", { source: fullItem.source_name || t("sourceFallback") })}
                </p>
              )}
              <Button variant="outline" size="sm" asChild>
                <a href={news.source_url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="w-4 h-4 mr-1.5" />
                  {t("viewOriginal")}
                </a>
              </Button>
            </div>
          )}

          {/* Related news */}
          {relatedNews.length > 0 && (
            <>
              <Separator />
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-bold">{t("relatedNews")}</h3>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    disabled={relatedCount <= 1}
                    onClick={() => setRelatedCount((c) => Math.max(1, c - 1))}
                    aria-label={t("fewerRelated")}
                  >
                    <Minus className="w-3.5 h-3.5" aria-hidden="true" />
                  </Button>
                  <span className="text-sm text-muted-foreground w-5 text-center" aria-live="polite">{relatedCount}</span>
                  <Button
                    variant="outline"
                    size="icon"
                    className="h-7 w-7"
                    disabled={relatedCount >= Math.min(4, relatedNews.length)}
                    onClick={() => setRelatedCount((c) => Math.min(4, relatedNews.length, c + 1))}
                    aria-label={t("moreRelated")}
                  >
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </div>
              <div className={`grid gap-3 ${relatedCount <= 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2"}`}>
                {relatedNews.slice(0, relatedCount).map((item) => (
                  // 관련 기사도 카드와 같은 링크 경로. replace 로 이동해 모달을 닫으면(back)
                  // 이전 기사가 아니라 목록으로 돌아가게 한다.
                  <Link
                    key={item.id}
                    href={`/news/${item.id}`}
                    replace
                    scroll={false}
                    prefetch={false}
                    className="block text-left p-3 rounded-lg border hover:bg-accent/50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <p className="text-sm font-medium line-clamp-2 mb-1">
                      {getTitle(item, locale)}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {item.category && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                          {getCategoryLabel(item.category, locale)}
                        </Badge>
                      )}
                      {item.news_date && <span>{formatDate(item.news_date, locale)}</span>}
                    </div>
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
