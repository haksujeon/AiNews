"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import {
  ArrowLeft,
  Calendar,
  ExternalLink,
  Globe,
  Lightbulb,
  BookOpen,
  Languages,
  FileText,
  Clock,
  List,
  Minus,
  Plus,
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
  getAiInsights,
  getCategoryStyle,
  getCategoryLabel,
  getSentimentStyle,
  getSentimentLabel,
} from "@/lib/news-utils";
import { NewsCard } from "./news-card";
import { NewsPlaceholder } from "./news-placeholder";

interface NewsDetailProps {
  news: NewsItem;
  relatedNews: NewsItem[];
}

function estimateReadTime(text: string, locale: string): string {
  const len = text.length;
  const cpm = locale === "en" ? 1200 : 600;
  const minutes = Math.max(1, Math.round(len / cpm));
  if (locale === "ko") return `${minutes}분 소요`;
  if (locale === "zh") return `${minutes}分钟阅读`;
  return `${minutes} min read`;
}

type ViewLang = "translated" | "cn";

export function NewsDetail({ news, relatedNews }: NewsDetailProps) {
  const locale = useLocale();
  const t = useTranslations("detail");
  const [viewLang, setViewLang] = useState<ViewLang>("translated");
  const [relatedCount, setRelatedCount] = useState(3);

  const showOriginal = viewLang === "cn";
  const hasChinese = locale !== "zh" && !!news.title_cn;

  const title = showOriginal && hasChinese
    ? news.title_cn!
    : getTitle(news, locale);

  const summary = showOriginal && hasChinese
    ? (news.summary_cn || getSummary(news, locale))
    : getSummary(news, locale);

  const content = showOriginal && hasChinese
    ? getContent({ ...news, content_kr: null, content_en: null } as NewsItem, "zh")
    : getContent(news, locale);

  const aiInsights = showOriginal && hasChinese
    ? (news.ai_insights_cn || getAiInsights(news, locale))
    : getAiInsights(news, locale);

  const imageUrl = news.thumbnail_url || news.og_image_url;
  const catStyle = getCategoryStyle(news.category);
  const sentStyle = getSentimentStyle(news.sentiment);
  const readTime = content ? estimateReadTime(content, showOriginal ? "zh" : locale) : null;

  const tocItems = [
    { id: "summary", label: locale === "ko" ? "AI 요약" : locale === "zh" ? "AI摘要" : "AI Summary", show: !!summary },
    { id: "content", label: locale === "ko" ? "뉴스 본문" : locale === "zh" ? "新闻正文" : "News Content", show: !!content },
    { id: "insights", label: locale === "ko" ? "AI 인사이트" : locale === "zh" ? "AI洞察" : "AI Insights", show: !!aiInsights },
    { id: "keywords", label: locale === "ko" ? "핵심 키워드" : locale === "zh" ? "关键词" : "Key Terms", show: !!(news.key_terms && news.key_terms.length > 0) },
  ].filter((item) => item.show);

  return (
    <article className="max-w-6xl mx-auto">
      {/* Top bar */}
      <div className="mb-6 flex items-center justify-between">
        <Link href="/">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="w-4 h-4 mr-2" />
            {t("backToList")}
          </Button>
        </Link>

        {/* Language toggle */}
        {hasChinese && (
          <div className="flex items-center gap-1 border rounded-lg p-0.5">
            <Button
              variant={!showOriginal ? "default" : "ghost"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setViewLang("translated")}
            >
              <Languages className="w-3.5 h-3.5 mr-1" />
              {locale === "ko" ? "번역" : "Translation"}
            </Button>
            <Button
              variant={showOriginal ? "default" : "ghost"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setViewLang("cn")}
            >
              <FileText className="w-3.5 h-3.5 mr-1" />
              {locale === "ko" ? "중문 원문" : "中文原文"}
            </Button>
          </div>
        )}
      </div>

      {/* Hero image */}
      {imageUrl ? (
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
      ) : (
        <div className="mb-8 rounded-xl overflow-hidden">
          <NewsPlaceholder category={news.category} className="h-64" />
        </div>
      )}

      {/* Badges */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        {news.country && (
          <Badge variant="secondary">
            <Globe className="w-3 h-3 mr-1" />
            {getCountryLabel(news.country)}
          </Badge>
        )}
        {news.category && (
          <Badge
            variant="outline"
            className={`${catStyle.text} ${catStyle.border}`}
          >
            {getCategoryLabel(news.category, locale)}
          </Badge>
        )}
        {news.sentiment && (
          <Badge
            variant="outline"
            className={`${sentStyle.text} ${sentStyle.border}`}
          >
            <span className={`w-2 h-2 rounded-full ${sentStyle.dot} mr-1.5`} />
            {getSentimentLabel(news.sentiment, locale)}
          </Badge>
        )}
      </div>

      {/* Title */}
      <h1 className="font-display text-4xl sm:text-5xl font-bold mb-4 leading-tight">{title}</h1>

      {/* Meta: date, source, read time */}
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
        {readTime && (
          <span className="flex items-center gap-1">
            <Clock className="w-4 h-4" />
            {readTime}
          </span>
        )}
      </div>

      <Separator className="mb-8" />

      {/* 2-column layout: main content + sidebar */}
      <div className="flex flex-col lg:flex-row gap-8">
        {/* Left: Main content */}
        <div className="flex-1 min-w-0">
          {/* AI Summary */}
          {summary && (
            <section id="summary" className="mb-6 scroll-mt-20">
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
            </section>
          )}

          {/* News Content */}
          {content && (
            <section id="content" className="mb-6 scroll-mt-20">
              <Card className="border-l-4 border-l-emerald-500 bg-emerald-500/5 border-border/30">
                <CardHeader className="pb-2 pt-4">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <BookOpen className="w-4 h-4 text-emerald-500" />
                    {locale === "ko" ? "뉴스 본문" : locale === "zh" ? "新闻正文" : "News Content"}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pb-4">
                  <div className="text-sm leading-relaxed text-muted-foreground whitespace-pre-wrap">{content}</div>
                </CardContent>
              </Card>
            </section>
          )}

          {/* Source link */}
          {news.source_url && (
            <div className="mb-8">
              <a href={news.source_url} target="_blank" rel="noopener noreferrer">
                <Button>
                  <ExternalLink className="w-4 h-4 mr-2" />
                  {t("viewOriginal")}
                </Button>
              </a>
            </div>
          )}
        </div>

        {/* Right: Sticky sidebar */}
        <aside className="lg:w-80 flex-shrink-0">
          <div className="lg:sticky lg:top-20 space-y-5">
            {/* TOC */}
            {tocItems.length > 1 && (
              <Card>
                <CardHeader className="pb-2 pt-3">
                  <CardTitle className="text-sm flex items-center gap-1.5">
                    <List className="w-4 h-4" />
                    {locale === "ko" ? "목차" : locale === "zh" ? "目录" : "Contents"}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pb-3">
                  <nav className="space-y-1">
                    {tocItems.map((item) => (
                      <a
                        key={item.id}
                        href={`#${item.id}`}
                        className="block text-sm text-muted-foreground hover:text-primary transition-colors py-1 pl-3 border-l-2 border-transparent hover:border-primary"
                      >
                        {item.label}
                      </a>
                    ))}
                  </nav>
                </CardContent>
              </Card>
            )}

            {/* AI Insights */}
            {aiInsights && (
              <section id="insights" className="scroll-mt-20">
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
              </section>
            )}

            {/* Key Terms */}
            {news.key_terms && news.key_terms.length > 0 && (
              <section id="keywords" className="scroll-mt-20">
                <Card className="border-l-4 border-l-violet-500 bg-violet-500/5 border-border/30">
                  <CardHeader className="pb-2 pt-4">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <BookOpen className="w-4 h-4 text-violet-500" />
                      {t("keyTerms")}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pb-4">
                    <div className="space-y-3">
                      {news.key_terms.map((term, index) => (
                        <div key={index} className="flex gap-3 items-start">
                          <Badge variant="secondary" className="text-xs shrink-0 mt-0.5">
                            {term.term}
                          </Badge>
                          <p className="text-xs leading-relaxed text-muted-foreground">
                            {term.explanation_kr}
                          </p>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              </section>
            )}
          </div>
        </aside>
      </div>

      {/* Related news */}
      {relatedNews.length > 0 && (
        <>
          <Separator className="my-8" />
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold">{t("relatedNews")}</h2>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={relatedCount <= 1}
                onClick={() => setRelatedCount((c) => Math.max(1, c - 1))}
              >
                <Minus className="w-4 h-4" />
              </Button>
              <span className="text-sm text-muted-foreground w-6 text-center">{relatedCount}</span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={relatedCount >= Math.min(4, relatedNews.length)}
                onClick={() => setRelatedCount((c) => Math.min(4, relatedNews.length, c + 1))}
              >
                <Plus className="w-4 h-4" />
              </Button>
            </div>
          </div>
          <div className={`grid gap-6 ${
            relatedCount === 1 ? "grid-cols-1" :
            relatedCount === 2 ? "grid-cols-1 md:grid-cols-2" :
            relatedCount === 3 ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-3" :
            "grid-cols-1 md:grid-cols-2 lg:grid-cols-4"
          }`}>
            {relatedNews.slice(0, relatedCount).map((item) => (
              <NewsCard key={item.id} item={item} />
            ))}
          </div>
        </>
      )}
    </article>
  );
}
