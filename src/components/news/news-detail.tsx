"use client";

import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { ArrowLeft } from "lucide-react";
import type { PublicNewsItem } from "@/lib/news-gist";
import type { RelatedSections } from "@/lib/related-types";
import {
  getTitle,
  getSummary,
  getAiInsights,
  getEasyExplain,
  getImageUrl,
  getCategoryLabel,
  getSentimentLabel,
  getSourceName,
} from "@/lib/news-utils";
import { NewsThumbnail } from "./news-thumbnail";
import { ArticleKicker } from "./article-kicker";
import { ArticleBody, ArticleByline, KeyTerms } from "./article-body";
import { RelatedSectionsView } from "./related-sections";
import { SubscribeBox } from "@/components/newsletter/subscribe-link";

interface NewsDetailProps {
  /** 서버에서 toPublicNewsItem() 을 거친 기사(번역 전문 없음, gist 만) */
  news: PublicNewsItem;
  /** 관련 기사 세 묶음 (src/lib/related.ts findRelated — 모달과 같은 함수·같은 컴포넌트) */
  relatedNews: RelatedSections;
}

/**
 * 기사 전체 페이지(직접 접속/새로고침). 모달과 같은 렌더 컴포넌트(ArticleByline/ArticleBody/KeyTerms)를 쓴다.
 * 레이아웃: 약 40rem 읽기 칼럼 + 오른쪽 300px 사이드(목차·핵심 용어·분류).
 */
export function NewsDetail({ news, relatedNews }: NewsDetailProps) {
  const locale = useLocale();
  const t = useTranslations("detail");

  const title = getTitle(news, locale);
  const summary = getSummary(news, locale);
  const aiInsights = getAiInsights(news, locale);
  const source = getSourceName(news.source_name);
  const hasKeyTerms = !!(news.key_terms && news.key_terms.length > 0);

  // 쉽게 풀어보기가 있으면 목차도 새 구성(요약 · 쉽게 풀어보기 · 핵심 용어) — ArticleBody 와 같은 판정(getEasyExplain)
  const easy = getEasyExplain(news, locale);
  const tocItems = [
    { id: "summary", label: easy ? t("summaryFact") : t("tocSummary"), show: !!summary },
    { id: "insights", label: easy ? t("easyTitle") : t("aiInsights"), show: !!(easy || aiInsights) },
    { id: "content", label: t("translatedGist"), show: !easy && !!news.gist },
    { id: "keywords", label: t("keyTerms"), show: hasKeyTerms },
  ].filter((item) => item.show);

  const facts = [
    { label: t("categoryLabel"), value: news.category ? getCategoryLabel(news.category, locale) : "" },
    { label: t("toneLabel"), value: getSentimentLabel(news.sentiment, locale) },
    { label: t("sourceLabel"), value: source, lang: source && source !== news.source_name ? "zh-CN" : undefined },
  ].filter((f) => f.value);

  return (
    <article className="mx-auto max-w-6xl">
      {/* "목록으로" = 뉴스 목록 (QA B-07: 홈으로 가고 있었다) */}
      <Link
        href="/news"
        className="mb-8 inline-flex items-center gap-1.5 rounded-sm text-[13px] text-ink-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        {t("backToList")}
      </Link>

      <div className="grid gap-12 lg:grid-cols-[minmax(0,42rem)_300px] lg:justify-between">
        {/* 읽기 칼럼 */}
        <div className="min-w-0">
          <ArticleKicker category={news.category} sourceName={news.source_name} locale={locale} region={news.subject_region} regionTags={news.region_tags} className="mb-3" />
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
          {/* 구독 신청 (2026-11-05, 권장 1순위) — 기사를 다 읽은 자리. 팝업과 같은 상자 */}
          <SubscribeBox source="article" className="mt-10" />
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

      {/* 관련 기사: 같은 사건 다른 매체 / 관련 흐름·후속 / 같은 기업 — 빈 묶음은 숨김 */}
      <RelatedSectionsView sections={relatedNews} locale={locale} variant="page" headingTag="h2" className="mt-16" />
    </article>
  );
}
