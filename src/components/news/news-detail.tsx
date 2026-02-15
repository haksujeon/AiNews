"use client";

import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import {
  ArrowLeft,
  Calendar,
  ExternalLink,
  Globe,
  User,
  Lightbulb,
  BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { NewsItem } from "@/lib/supabase";
import {
  getCountryLabel,
  formatDate,
  getTitle,
  getSummary,
  getContent,
} from "@/lib/news-utils";
import { NewsCard } from "./news-card";

interface NewsDetailProps {
  news: NewsItem;
  relatedNews: NewsItem[];
}

export function NewsDetail({ news, relatedNews }: NewsDetailProps) {
  const locale = useLocale();
  const t = useTranslations("detail");
  const title = getTitle(news, locale);
  const summary = getSummary(news, locale);
  const content = getContent(news, locale);
  const imageUrl = news.thumbnail_url || news.og_image_url;

  return (
    <article className="max-w-4xl mx-auto">
      <div className="mb-6">
        <Link href="/">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            {t("backToList")}
          </Button>
        </Link>
      </div>

      {imageUrl && (
        <div className="mb-8 rounded-xl overflow-hidden relative bg-muted">
          <img
            src={imageUrl}
            alt={title}
            referrerPolicy="no-referrer"
            crossOrigin="anonymous"
            className="w-full h-auto max-h-[400px] object-cover"
            onError={(e) => {
              const img = e.target as HTMLImageElement;
              img.style.display = "none";
              const parent = img.parentElement!;
              if (!parent.querySelector(".img-fallback")) {
                const fallback = document.createElement("div");
                fallback.className = "img-fallback flex items-center justify-center h-48 bg-muted text-muted-foreground";
                fallback.textContent = "AI NEWS";
                parent.appendChild(fallback);
              }
            }}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 mb-4">
        {news.country && (
          <Badge variant="secondary">
            <Globe className="w-3 h-3 mr-1" />
            {getCountryLabel(news.country)}
          </Badge>
        )}
        {news.category && (
          <Badge variant="outline" className="capitalize">
            {news.category}
          </Badge>
        )}
        {news.sentiment && (
          <Badge
            variant="outline"
            className={
              news.sentiment === "positive"
                ? "text-green-600 border-green-300"
                : news.sentiment === "negative"
                  ? "text-red-600 border-red-300"
                  : ""
            }
          >
            {news.sentiment}
          </Badge>
        )}
      </div>

      <h1 className="text-3xl sm:text-4xl font-bold mb-4">{title}</h1>

      {locale === "ko" && news.title_en && (
        <p className="text-lg text-muted-foreground italic mb-4">
          {news.title_en}
        </p>
      )}
      {locale === "en" && news.title_kr && (
        <p className="text-lg text-muted-foreground italic mb-4">
          {news.title_kr}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground mb-6">
        {news.news_date && (
          <span className="flex items-center gap-1">
            <Calendar className="w-4 h-4" />
            {formatDate(news.news_date, locale)}
          </span>
        )}
        {news.source_name && (
          <span className="flex items-center gap-1">
            <BookOpen className="w-4 h-4" />
            {news.source_name}
          </span>
        )}
        {news.author && (
          <span className="flex items-center gap-1">
            <User className="w-4 h-4" />
            {news.author}
          </span>
        )}
      </div>

      <Separator className="mb-6" />

      {summary && (
        <Card className="mb-6 border-l-4 border-l-primary">
          <CardContent className="pt-4">
            <p className="text-sm font-semibold text-primary mb-2">
              {t("aiSummary")}
            </p>
            <p className="text-foreground leading-relaxed">{summary}</p>
          </CardContent>
        </Card>
      )}

      {content && (
        <div className="prose prose-neutral dark:prose-invert max-w-none mb-8">
          <div className="whitespace-pre-wrap leading-relaxed">{content}</div>
        </div>
      )}

      {news.ai_insights && (
        <Card className="mb-8 bg-accent/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <Lightbulb className="w-5 h-5 text-yellow-500" />
              {t("aiInsights")}
              {locale !== "en" && (
                <Badge variant="outline" className="text-xs font-normal ml-1">
                  EN
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm leading-relaxed text-muted-foreground">
              {news.ai_insights}
            </p>
          </CardContent>
        </Card>
      )}

      {news.key_terms && news.key_terms.length > 0 && (
        <Card className="mb-8">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">{t("keyTerms")}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {news.key_terms.map((term, index) => (
                <div key={index} className="flex gap-3">
                  <Badge variant="secondary" className="h-fit shrink-0">
                    {term.term}
                  </Badge>
                  <p className="text-sm text-muted-foreground">
                    {term.explanation_kr}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="flex gap-3 mb-12">
        {news.source_url && (
          <a href={news.source_url} target="_blank" rel="noopener noreferrer">
            <Button>
              <ExternalLink className="w-4 h-4 mr-2" />
              {t("viewOriginal")}
            </Button>
          </a>
        )}
        <Link href="/">
          <Button variant="outline">{t("backToList")}</Button>
        </Link>
      </div>

      {relatedNews.length > 0 && (
        <>
          <Separator className="mb-8" />
          <h2 className="text-2xl font-bold mb-6">{t("relatedNews")}</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {relatedNews.map((item) => (
              <NewsCard key={item.id} item={item} />
            ))}
          </div>
        </>
      )}
    </article>
  );
}
