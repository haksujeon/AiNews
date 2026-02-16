"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import Image from "next/image";
import {
  Calendar,
  Globe,
  ExternalLink,
  Lightbulb,
  BookOpen,
  X,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { NewsItem } from "@/lib/supabase";
import { fetchNewsDetailClient } from "@/lib/supabase-client";
import {
  getCountryLabel,
  formatDate,
  getTitle,
  getSummary,
  getContent,
  getCategoryStyle,
  getSentimentStyle,
  getSentimentLabel,
} from "@/lib/news-utils";
import { NewsPlaceholder } from "./news-placeholder";
import { motion } from "framer-motion";

interface NewsCardProps {
  item: NewsItem;
  isExpanded?: boolean;
  onToggle?: () => void;
}

export function NewsCard({ item, isExpanded = false, onToggle }: NewsCardProps) {
  const locale = useLocale();
  const t = useTranslations("detail");
  const title = getTitle(item, locale);
  const summary = getSummary(item, locale);
  const imageUrl = item.thumbnail_url || item.og_image_url;
  const catStyle = getCategoryStyle(item.category);
  const sentStyle = getSentimentStyle(item.sentiment);

  const [detail, setDetail] = useState<NewsItem | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isExpanded && !detail) {
      setLoading(true);
      fetchNewsDetailClient(item.id).then((data) => {
        setDetail(data);
        setLoading(false);
      });
    }
  }, [isExpanded, detail, item.id]);

  // Reset detail data when collapsed
  useEffect(() => {
    if (!isExpanded) {
      setDetail(null);
    }
  }, [isExpanded]);

  if (isExpanded) {
    const fullItem = detail ?? item;
    const content = getContent(fullItem, locale);

    return (
      <Card className="col-span-full overflow-hidden border-primary/30 shadow-lg">
        <div className="relative">
          {/* Close button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggle?.();
            }}
            className="absolute top-3 right-3 z-10 rounded-full bg-background/80 backdrop-blur-sm p-1.5 hover:bg-background transition-colors border shadow-sm"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="flex flex-col lg:flex-row">
            {/* Left: Image */}
            <div className="lg:w-80 flex-shrink-0">
              {imageUrl ? (
                <div className="h-56 lg:h-full overflow-hidden bg-muted relative">
                  <Image
                    src={imageUrl}
                    alt={title}
                    fill
                    className="object-cover"
                    sizes="(max-width: 1024px) 100vw, 320px"
                    referrerPolicy="no-referrer"
                    unoptimized
                    onError={() => {
                      // Image will show placeholder via NewsPlaceholder
                    }}
                  />
                </div>
              ) : (
                <NewsPlaceholder
                  category={item.category}
                  className="h-56 lg:h-full"
                />
              )}
            </div>

            {/* Right: Content area */}
            <div className="flex-1 p-6">
              {/* Badges */}
              <div className="flex flex-wrap items-center gap-2 mb-3">
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
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${sentStyle.dot} mr-1`}
                    />
                    {getSentimentLabel(item.sentiment, locale)}
                  </Badge>
                )}
              </div>

              {/* Title */}
              <h2 className="text-xl font-bold mb-2">{title}</h2>

              {/* Meta */}
              <div className="flex items-center gap-3 text-sm text-muted-foreground mb-4">
                {item.news_date && (
                  <span className="flex items-center gap-1">
                    <Calendar className="w-3.5 h-3.5" />
                    {formatDate(item.news_date, locale)}
                  </span>
                )}
                {item.source_name && (
                  <span className="flex items-center gap-1">
                    <BookOpen className="w-3.5 h-3.5" />
                    {item.source_name}
                  </span>
                )}
              </div>

              {loading ? (
                <div className="flex items-center gap-2 py-8 text-muted-foreground">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="text-sm">{locale === "ko" ? "로딩 중..." : locale === "zh" ? "加载中..." : "Loading..."}</span>
                </div>
              ) : (
                <>
                  {/* AI Summary */}
                  {summary && (
                    <Card className="mb-4 border-l-4 border-l-primary">
                      <CardContent className="pt-3 pb-3">
                        <p className="text-xs font-semibold text-primary mb-1">
                          {t("aiSummary")}
                        </p>
                        <p className="text-sm leading-relaxed">{summary}</p>
                      </CardContent>
                    </Card>
                  )}

                  {/* AI Insights */}
                  {fullItem.ai_insights && (
                    <Card className="mb-4 bg-accent/50">
                      <CardHeader className="pb-1 pt-3">
                        <CardTitle className="text-sm flex items-center gap-1.5">
                          <Lightbulb className="w-4 h-4 text-yellow-500" />
                          {t("aiInsights")}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="pb-3">
                        <p className="text-sm leading-relaxed text-muted-foreground">
                          {fullItem.ai_insights}
                        </p>
                      </CardContent>
                    </Card>
                  )}

                  {/* Content preview */}
                  {content && (
                    <div className="mb-4">
                      <p className="text-sm text-muted-foreground leading-relaxed line-clamp-6 whitespace-pre-wrap">
                        {content}
                      </p>
                    </div>
                  )}

                  {/* Key terms */}
                  {fullItem.key_terms && fullItem.key_terms.length > 0 && (
                    <div className="mb-4">
                      <p className="text-xs font-semibold mb-2">
                        {t("keyTerms")}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {fullItem.key_terms.map((term, index) => (
                          <Badge
                            key={index}
                            variant="secondary"
                            className="text-xs"
                            title={term.explanation_kr}
                          >
                            {term.term}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex items-center gap-3 pt-2">
                    <Link href={`/news/${item.id}`}>
                      <Button size="sm">
                        {t("viewFullArticle")}
                      </Button>
                    </Link>
                    {item.source_url && (
                      <a
                        href={item.source_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button variant="outline" size="sm">
                          <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                          {t("viewOriginal")}
                        </Button>
                      </a>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </Card>
    );
  }

  // Collapsed state (default card)
  const cardContent = (
      <Card className="group h-full overflow-hidden transition-all duration-300 hover:shadow-lg hover:-translate-y-1 cursor-pointer">
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
  );

  if (onToggle) {
    return <div onClick={onToggle}>{cardContent}</div>;
  }

  return <Link href={`/news/${item.id}`}>{cardContent}</Link>;
}
