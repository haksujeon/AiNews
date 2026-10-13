"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { ArrowLeft, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { NewsItem } from "@/lib/supabase";
import {
  getTitle,
  getSummary,
  getContent,
  getAiInsights,
  getImageUrl,
  getCategoryLabel,
  getSentimentLabel,
  getSourceName,
} from "@/lib/news-utils";
import { NewsCard } from "./news-card";
import { NewsThumbnail } from "./news-thumbnail";
import { ArticleKicker } from "./article-kicker";
import { ArticleBody, ArticleByline, KeyTerms } from "./article-body";

interface NewsDetailProps {
  news: NewsItem;
  relatedNews: NewsItem[];
}

/**
 * 기사 전체 페이지(직접 접속/새로고침). 모달과 같은 렌더 컴포넌트(ArticleByline/ArticleBody/KeyTerms)를 쓴다.
 * 레이아웃: 약 40rem 읽기 칼럼 + 오른쪽 300px 사이드(목차·핵심 용어·분류).
 */
export function NewsDetail({ news, relatedNews }: NewsDetailProps) {
  const locale = useLocale();
  const t = useTranslations("detail");
  const [relatedCount, setRelatedCount] = useState(3);

  const title = getTitle(news, locale);
  const summary = getSummary(news, locale);
  const content = getContent(news, locale);
  const aiInsights = getAiInsights(news, locale);
  const source = getSourceName(news.source_name);
  const hasKeyTerms = !!(news.key_terms && news.key_terms.length > 0);

  const tocItems = [
    { id: "summary", label: t("tocSummary"), show: !!summary },
    { id: "insights", label: t("aiInsights"), show: !!aiInsights },
    { id: "content", label: t("translatedBody"), show: !!content },
    { id: "keywords", label: t("tocKeyTerms"), show: hasKeyTerms },
  ].filter((item) => item.show);

  const facts = [
    { label: t("categoryLabel"), value: news.category ? getCategoryLabel(news.category, locale) : "" },
    { label: t("toneLabel"), value: getSentimentLabel(news.sentiment, locale) },
    { label: t("sourceLabel"), value: source, lang: source && source !== news.source_name ? "zh-CN" : undefined },
  ].filter((f) => f.value);

  return (
    <article className="mx-auto max-w-6xl">
      <Link
        href="/"
        className="mb-8 inline-flex items-center gap-1.5 rounded-sm text-[13px] text-ink-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        {t("backToList")}
      </Link>

      <div className="grid gap-12 lg:grid-cols-[minmax(0,42rem)_300px] lg:justify-between">
        {/* 읽기 칼럼 */}
        <div className="min-w-0">
          <ArticleKicker category={news.category} sourceName={news.source_name} locale={locale} className="mb-3" />
          <h1 className="mb-6 text-[28px] font-bold leading-[1.25] tracking-[-0.022em] text-ink sm:text-[34px] lg:text-[40px]">
            {title}
          </h1>
          <ArticleByline news={news} locale={locale} className="mb-8" />

          <NewsThumbnail
            src={getImageUrl(news)}
            alt={title}
            className="mb-8 aspect-[16/9] w-full"
            sizes="(max-width: 1024px) 100vw, 672px"
          />

          <ArticleBody news={news} locale={locale} headingTag="h2" />
        </div>

        {/* 사이드 */}
        <aside className="lg:sticky lg:top-20 lg:self-start space-y-10">
          {tocItems.length > 1 && (
            <nav aria-label={t("toc")} className="hidden lg:block">
              <h2 className="border-b border-rule-strong pb-2 text-sm font-bold text-ink">{t("toc")}</h2>
              <ul className="mt-2 space-y-0.5">
                {tocItems.map((item) => (
                  <li key={item.id}>
                    <a
                      href={`#${item.id}`}
                      className="block rounded-sm py-1.5 text-sm text-ink-2 hover:text-ink hover:underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          )}

          <KeyTerms terms={news.key_terms} locale={locale} headingTag="h2" />

          {facts.length > 0 && (
            <dl className="space-y-3 text-sm">
              {facts.map((f) => (
                <div key={f.label}>
                  <dt className="text-xs text-ink-3">{f.label}</dt>
                  <dd className="mt-0.5 text-ink" lang={f.lang}>{f.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </aside>
      </div>

      {/* Related news */}
      {relatedNews.length > 0 && (
        <section className="mt-16">
          <div className="mb-6 flex items-center justify-between border-b border-rule-strong pb-2">
            <h2 className="text-lg font-bold text-ink">{t("relatedNews")}</h2>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={relatedCount <= 1}
                onClick={() => setRelatedCount((c) => Math.max(1, c - 1))}
                aria-label={t("fewerRelated")}
              >
                <Minus className="h-4 w-4" aria-hidden="true" />
              </Button>
              <span className="w-6 text-center text-sm text-ink-2" aria-live="polite">{relatedCount}</span>
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8"
                disabled={relatedCount >= Math.min(4, relatedNews.length)}
                onClick={() => setRelatedCount((c) => Math.min(4, relatedNews.length, c + 1))}
                aria-label={t("moreRelated")}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
          </div>
          <div
            className={`grid gap-x-8 gap-y-6 ${
              relatedCount === 1
                ? "grid-cols-1"
                : relatedCount === 2
                  ? "grid-cols-1 md:grid-cols-2"
                  : relatedCount === 3
                    ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
                    : "grid-cols-1 md:grid-cols-2 lg:grid-cols-4"
            }`}
          >
            {relatedNews.slice(0, relatedCount).map((item) => (
              <NewsCard key={item.id} item={item} />
            ))}
          </div>
        </section>
      )}
    </article>
  );
}
