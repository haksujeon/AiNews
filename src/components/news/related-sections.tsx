"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { getSourceName, getTitle } from "@/lib/news-utils";
import { hasRelated, type RelatedItem, type RelatedSections } from "@/lib/related-types";
import { ArticleKicker } from "./article-kicker";

interface RelatedSectionsViewProps {
  sections: RelatedSections;
  locale: string;
  /** page = 상세 페이지(흐름·같은 기업 두 칸), modal = 모달(한 칸, replace 이동) */
  variant: "page" | "modal";
  headingTag?: "h2" | "h3";
  className?: string;
}

/**
 * 관련 기사 세 묶음 — 상세 페이지(NewsDetail)와 모달(NewsDetailModal)이 같은 컴포넌트를 쓴다 (Gate 2).
 * 같은 사건 다른 매체: 매체 이름 한 줄(각 이름이 그 기사로 가는 링크) / 관련 흐름·후속: 최신순 + 날짜 차이 / 같은 기업 소식.
 * 빈 묶음은 그리지 않고, 셋 다 비면 영역 전체를 그리지 않는다.
 */
export function RelatedSectionsView({ sections, locale, variant, headingTag = "h2", className }: RelatedSectionsViewProps) {
  const t = useTranslations("related");
  if (!hasRelated(sections)) return null;
  const H = headingTag;
  const Sub = headingTag === "h2" ? "h3" : "h4";
  // 모달 안 링크: replace 로 이동해 모달을 닫으면(back) 이전 기사가 아니라 목록으로 돌아가게 한다
  const linkProps = variant === "modal" ? ({ replace: true, scroll: false, prefetch: false } as const) : ({ prefetch: false } as const);
  const focus = "rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

  const gapLabel = (gap: number) => (gap < 0 ? t("daysBefore", { n: -gap }) : t("daysAfter", { n: gap }));

  const list = (items: RelatedItem[], withGap: boolean) => (
    <ul className="divide-y divide-rule">
      {items.map((item) => (
        <li key={item.id}>
          <Link
            href={`/news/${item.id}`}
            {...linkProps}
            data-related-id={item.id}
            className={cn("group grid gap-1 py-3 text-left", focus)}
          >
            <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
              {withGap && (
                <span className="text-xs font-semibold tabular-nums text-ink-2" data-testid="related-gap">
                  {gapLabel(item.gap)}
                </span>
              )}
              <ArticleKicker category={item.category} sourceName={item.source_name} locale={locale} region={item.subject_region} regionTags={item.region_tags} />
            </span>
            <span
              className={cn(
                "line-clamp-2 font-semibold leading-snug text-ink decoration-1 underline-offset-[3px] group-hover:underline",
                variant === "page" ? "text-base" : "text-[15px]"
              )}
            >
              {getTitle(item, locale)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );

  const block = (key: "flow" | "company", items: RelatedItem[], withGap: boolean) =>
    items.length > 0 && (
      <section data-section={key} className="min-w-0 pt-4">
        <Sub className="border-b border-rule pb-1.5 text-[13px] font-[650] text-ink-2">{t(key)}</Sub>
        {list(items, withGap)}
      </section>
    );

  return (
    <section aria-labelledby={`related-title-${variant}`} data-testid="related-sections" className={className}>
      <H id={`related-title-${variant}`} className={cn("border-b border-rule-strong pb-2 font-bold text-ink", variant === "page" ? "text-lg" : "text-sm")}>
        {t("title")}
      </H>

      {sections.sameEvent.length > 0 && (
        <p data-section="sameEvent" className="flex flex-wrap items-baseline gap-x-2 gap-y-1 border-b border-rule py-3 text-sm leading-relaxed">
          <span className="mr-1 text-[13px] font-[650] text-ink-2">{t("sameEvent")}</span>
          {sections.sameEvent.map((item, i) => {
            const outlet = getSourceName(item.source_name) || item.source_name || "";
            const title = getTitle(item, locale);
            return (
              <span key={item.id} className="inline-flex items-baseline gap-x-2">
                {i > 0 && (
                  <span aria-hidden="true" className="text-ink-3">
                    ·
                  </span>
                )}
                <Link
                  href={`/news/${item.id}`}
                  {...linkProps}
                  data-related-id={item.id}
                  title={title}
                  aria-label={t("outletLink", { outlet, title })}
                  lang={outlet !== item.source_name ? "zh-CN" : undefined}
                  className={cn("font-medium text-ink underline decoration-rule decoration-1 underline-offset-4 hover:decoration-ink-2", focus)}
                >
                  {outlet}
                </Link>
              </span>
            );
          })}
        </p>
      )}

      <div className={cn("grid gap-x-10 gap-y-2", variant === "page" && sections.flow.length > 0 && sections.company.length > 0 && "lg:grid-cols-2")}>
        {block("flow", sections.flow, true)}
        {block("company", sections.company, false)}
      </div>
    </section>
  );
}
