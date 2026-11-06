"use client";

import { useEffect, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import type { NewsItem } from "@/lib/supabase";
import type { PublicNewsItem } from "@/lib/news-gist";
import type { FxRates } from "@/lib/fx/convert";
import { FxNote } from "@/components/fx/fx-note";
import { cn } from "@/lib/utils";
import {
  formatDate,
  getSummary,
  getAiInsights,
  getAiInsightsDetail,
  getSourceName,
  getTermExplanation,
} from "@/lib/news-utils";

/*
 * 상세 페이지(NewsDetail)와 모달(NewsDetailModal)이 함께 쓰는 기사 렌더링.
 * 프로젝트 규칙(같은 기능 = 같은 함수)에 따라 두 화면은 바이라인·요약·인사이트·본문·핵심 용어를
 * 여기 있는 같은 컴포넌트로 그린다. 제목은 화면마다 다르게 감싼다(페이지 h1 / 모달 DialogTitle).
 *
 * 원문(content_cn) 전문도, 번역 전문(content_kr/en)도 재게시하지 않는다(P0-7).
 * 서버가 toPublicNewsItem() 으로 번역문 앞 3~5문장 요지(news.gist)만 넘기고, 전문은 항상
 * source_url 외부 링크로 안내한다. zh 화면은 gist 가 "" 이라 원문 안내만 보인다.
 * 읽기 시간 표시는 뺐다(요지 기준으로는 의미가 없다).
 */

type HeadingTag = "h2" | "h3";

const sectionLabel = "mb-3 text-xs font-semibold text-ink-3";

/** 바이라인: 원어 출처(굵게)·날짜, 오른쪽 "원문 보기" 링크. 위아래 괘선. */
export function ArticleByline({
  news,
  locale,
  className,
}: {
  news: Pick<NewsItem, "source_name" | "source_url" | "news_date">;
  locale: string;
  className?: string;
}) {
  const t = useTranslations("detail");
  const source = getSourceName(news.source_name);
  const isOriginalName = !!source && source !== news.source_name;

  return (
    <div
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-y border-rule py-3 text-[13px]",
        className
      )}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-ink-3">
        {source && (
          <span className="font-semibold text-ink" lang={isOriginalName ? "zh-CN" : undefined}>
            {source}
          </span>
        )}
        {news.news_date && (
          <time dateTime={news.news_date.split("T")[0]}>{formatDate(news.news_date, locale)}</time>
        )}
      </div>
      {news.source_url && (
        <a
          href={news.source_url}
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-sm font-medium text-ink underline decoration-rule-strong/40 decoration-1 underline-offset-4 hover:decoration-rule-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("viewOriginal")}
        </a>
      )}
    </div>
  );
}

/** 요약(첫 문단) → AI 인사이트 1블록 → 번역 요지(3~5문장) → 원문 매체 안내(항상). */
export function ArticleBody({
  news,
  locale,
  headingTag: Heading = "h2",
}: {
  /** fx: 금액 환산에 쓴 환율 (서버 withNewsFx, fx/news.ts). 있으면 맨 아래 각주 */
  news: PublicNewsItem & { fx?: FxRates | null };
  locale: string;
  headingTag?: HeadingTag;
}) {
  const t = useTranslations("detail");
  const summary = getSummary(news, locale);
  const gist = news.gist;
  const aiInsights = getAiInsights(news, locale);
  const aiInsightsDetail = getAiInsightsDetail(news, locale);

  return (
    <div className="space-y-8">
      {summary && (
        <section id="summary" className="scroll-mt-20">
          <Heading className={sectionLabel}>{t("aiSummary")}</Heading>
          <p className="text-[17px] font-medium leading-[1.75] text-ink sm:text-[19px]">{summary}</p>
        </section>
      )}

      {aiInsights && (
        <section
          id="insights"
          className="scroll-mt-20 border-l-[3px] border-jade bg-jade-weak px-5 py-4 sm:px-6 sm:py-5"
        >
          <Heading className="mb-2 text-xs font-semibold text-jade">{t("aiInsights")}</Heading>
          <p className="text-[15px] leading-[1.8] text-ink">{aiInsights}</p>
          {aiInsightsDetail && <InsightDetail text={aiInsightsDetail} />}
          <p className="mt-3 text-xs leading-relaxed text-ink-3">{t("aiInsightDisclosure")}</p>
        </section>
      )}

      {gist && (
        <section id="content" className="scroll-mt-20">
          <Heading className={sectionLabel}>{t("translatedGist")}</Heading>
          <p data-testid="article-gist" className="text-base leading-[1.85] text-ink-2 sm:text-[17px]">
            {gist}
          </p>
          <p className="mt-3 text-xs leading-relaxed text-ink-3">{t("gistNote")}</p>
        </section>
      )}

      {news.fx && <FxNote fx={news.fx} locale={locale} className="block text-xs leading-relaxed text-ink-3" />}

      {/* 전문은 항상 원문 매체에서 — 요지가 있어도 없어도 같은 안내 */}
      {news.source_url && (
        <p data-testid="read-full-at-source" className="text-[15px] leading-relaxed text-ink-2">
          {t("readFullAtSource", { source: getSourceName(news.source_name) || t("sourceFallback") })}{" "}
          <a
            href={news.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-sm font-medium text-ink underline decoration-1 underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t("viewOriginal")}
          </a>
        </p>
      )}
    </div>
  );
}

/** 펼침 상태 기억 (보는 사람 브라우저에만). 읽기·쓰기 실패해도 접힘으로 정상 동작 */
const INSIGHT_DETAIL_KEY = "ainews.insightDetail";

/**
 * "자세히" 단계 인사이트 (2026-11-04, src/lib/insights.ts). 쉬운 글 아래 버튼 → 같은 상자 안에서 펼친다.
 * 마지막에 고른 상태(펼침/접힘)를 기억해 다음 기사에도 적용한다. 첫 렌더는 항상 접힘(서버와 같은 모양) → 마운트 뒤 기억값 적용.
 */
function InsightDetail({ text }: { text: string }) {
  const t = useTranslations("detail");
  const id = useId();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    try {
      if (window.localStorage.getItem(INSIGHT_DETAIL_KEY) === "open") setOpen(true);
    } catch {
      /* 저장소를 못 쓰면 접힘 그대로 */
    }
  }, []);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      window.localStorage.setItem(INSIGHT_DETAIL_KEY, next ? "open" : "closed");
    } catch {
      /* 기억만 못 할 뿐 */
    }
  };
  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={id}
        className="inline-flex min-h-9 items-center gap-1 rounded-sm text-[13px] font-semibold text-jade hover:underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {open ? t("insightDetailHide") : t("insightDetailShow")}
        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      <div id={id} hidden={!open}>
        <p className="mt-2 border-t border-jade/20 pt-3 text-[15px] leading-[1.8] text-ink-2">{text}</p>
      </div>
    </div>
  );
}

/** 핵심 용어: 원어 용어 + 병음 + 설명. (명조 한자·ruby 시그니처는 P1) */
export function KeyTerms({
  terms,
  locale,
  headingTag: Heading = "h2",
  className,
}: {
  terms: NewsItem["key_terms"];
  locale: string;
  headingTag?: HeadingTag;
  className?: string;
}) {
  const t = useTranslations("detail");
  if (!terms || terms.length === 0) return null;

  return (
    <section id="keywords" className={cn("scroll-mt-20", className)}>
      <Heading className="border-b border-rule-strong pb-2 text-sm font-bold text-ink">{t("keyTerms")}</Heading>
      <dl className="divide-y divide-rule">
        {terms.map((term, index) => (
          <div key={index} className="py-3">
            <dt className="flex flex-wrap items-baseline gap-x-2">
              <span lang="zh-CN" className="text-lg font-semibold text-ink">
                {term.term}
              </span>
              {term.pinyin && <span className="text-xs text-jade">{term.pinyin}</span>}
            </dt>
            <dd className="mt-1 text-sm leading-relaxed text-ink-2">{getTermExplanation(term, locale)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
