import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { isLocale, LOCALE_HTML_LANG, type Locale } from "@/i18n/routing";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PeriodicView } from "@/components/briefing/periodic-view";
import { BriefingTabs, WEEKLY_PATH } from "@/components/briefing/briefing-tabs";
import { absoluteUrl, publishedLanguageAlternates } from "@/lib/site";
import { isoWeekRange } from "@/lib/metrics/period";
import { beijingToday } from "@/lib/briefing/generate";
import { getPublishedWeekly, getPublishedWeeklyLocales, type PublicWeekly } from "@/lib/briefing/periodic/public";
import { BRIEFING_PATH, safeJsonLd } from "@/lib/briefing/view";
import { organizationLd } from "@/lib/seo/jsonld";
import type { BriefingLocale } from "@/lib/briefing/types";

/*
 * /[locale]/briefing/weekly (최신 발행 주) 와 /[locale]/briefing/weekly/[week] 가 함께 쓰는 서버 렌더러·메타데이터.
 * 공개는 발행본만. 리포트 문장은 MVP 에서 한국어판만 있으므로 en/zh 는 데일리와 같은 "언어판 없음" 안내로 간다.
 * canonical 은 언제나 주 URL(/briefing/weekly/2026-W44).
 */

export const weeklyPath = (week: string) => `${WEEKLY_PATH}/${week}`;

type Resolved =
  | { kind: "ok"; weekly: PublicWeekly }
  | { kind: "locale_missing"; week: string; locales: BriefingLocale[] }
  | { kind: "empty" }
  | { kind: "not_found" };

/** 형식이 맞고 이미 끝난 주인가 (미래·진행 중인 주는 404) */
export function isPublicWeek(week: string): boolean {
  const r = isoWeekRange(week);
  return !!r && r.end < beijingToday();
}

const resolve = cache(async function resolve(locale: string, week?: string): Promise<Resolved> {
  if (!isLocale(locale)) return { kind: "not_found" };
  if (week !== undefined && !isPublicWeek(week)) return { kind: "not_found" };
  const weekly = await getPublishedWeekly(locale, week);
  if (weekly) return { kind: "ok", weekly };
  const other = await getPublishedWeeklyLocales(week);
  if (other && other.locales.length) return { kind: "locale_missing", week: other.week, locales: other.locales };
  return week ? { kind: "not_found" } : { kind: "empty" };
});

function alternates(week: string, locales: BriefingLocale[]): Record<string, string> {
  return publishedLanguageAlternates(weeklyPath(week), locales);
}

/** NewsArticle: isBasedOn 인용 기사 상위 10건, creditText "AI 작성·편집자 검토" */
export function weeklyJsonLd(w: PublicWeekly, opts: { brand: string; title: string; credit: string }) {
  const url = absoluteUrl(w.locale, weeklyPath(w.iso_week));
  // 발행자는 레이아웃·기사 상세·데일리와 같은 organizationLd (Gate 2)
  const org = organizationLd(w.locale, opts.brand);
  return {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: opts.title.slice(0, 110),
    description: w.content.dek,
    datePublished: w.published_at || `${w.period_end}T23:59:00+08:00`,
    dateModified: w.published_at || `${w.period_end}T23:59:00+08:00`,
    inLanguage: LOCALE_HTML_LANG[w.locale as Locale],
    mainEntityOfPage: url,
    url,
    author: org,
    publisher: org,
    isAccessibleForFree: true,
    creditText: opts.credit,
    temporalCoverage: `${w.period_start}/${w.period_end}`,
    isBasedOn: Object.keys(w.articles)
      .slice(0, 10)
      .map((id) => absoluteUrl(w.locale, `/news/${id}`)),
  };
}

export async function weeklyMetadata(locale: string, week?: string): Promise<Metadata> {
  const r = await resolve(locale, week);
  const loc = isLocale(locale) ? locale : "ko";
  const t = await getTranslations({ locale: loc, namespace: "meta" });
  if (r.kind === "ok") {
    const w = r.weekly;
    const title = t("weeklyTitle", { week: w.iso_week, headline: w.content.headline });
    const url = absoluteUrl(w.locale, weeklyPath(w.iso_week));
    return {
      title: { absolute: title },
      description: w.content.dek,
      alternates: { canonical: url, languages: alternates(w.iso_week, w.available_locales) },
      openGraph: { type: "article", title, description: w.content.dek, url, publishedTime: w.published_at || undefined },
      twitter: { card: "summary", title, description: w.content.dek },
    };
  }
  if (r.kind === "not_found") {
    const tn = await getTranslations({ locale: loc, namespace: "notFound" });
    return { title: tn("title"), robots: { index: false } };
  }
  return { title: t("weeklyLatestTitle"), description: t("weeklyDescription"), robots: { index: false, follow: true } };
}

export async function WeeklyPageContent({ locale, week }: { locale: string; week?: string }) {
  const r = await resolve(locale, week);
  if (r.kind === "not_found") notFound();
  const t = await getTranslations({ locale, namespace: "weekly" });
  const tb = await getTranslations({ locale, namespace: "briefing" });
  const tm = await getTranslations({ locale, namespace: "meta" });

  let body: React.ReactNode;
  if (r.kind === "ok") {
    const w = r.weekly;
    const jsonLd = weeklyJsonLd(w, { brand: tm("brand"), title: tm("weeklyTitle", { week: w.iso_week, headline: w.content.headline }), credit: t("aiLabel") });
    body = (
      <>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }} />
        <PeriodicView weekly={w} />
      </>
    );
  } else if (r.kind === "locale_missing") {
    body = (
      <section className="max-w-xl py-16" data-testid="weekly-locale-missing">
        <h1 className="text-2xl font-bold text-ink">{t("localeMissingTitle")}</h1>
        <p className="mt-3 text-ink-2">{t("localeMissingBody", { week: r.week })}</p>
        <ul className="mt-4 flex flex-wrap gap-4">
          {r.locales.map((l) => (
            <li key={l}>
              <Link
                href={weeklyPath(r.week)}
                locale={l}
                className="rounded-sm font-medium text-ink underline decoration-1 underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {tb(`langName_${l}`)}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    );
  } else {
    body = (
      <section className="max-w-xl py-16" data-testid="weekly-empty">
        <h1 className="text-2xl font-bold text-ink">{t("emptyTitle")}</h1>
        <p className="mt-3 text-ink-2">{t("emptyBody")}</p>
        <Link href={BRIEFING_PATH} className="mt-4 inline-block font-medium text-ink underline underline-offset-4">
          {t("backDaily")}
        </Link>
      </section>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main id="main" className="container mx-auto flex-1 px-4">
        <BriefingTabs current="weekly" />
        {body}
      </main>
      <Footer />
    </div>
  );
}
