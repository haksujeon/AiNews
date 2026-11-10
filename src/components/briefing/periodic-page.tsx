import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { notFoundMetadata } from "@/lib/seo/not-found-meta";
import { Link } from "@/i18n/navigation";
import { isLocale, LOCALE_HTML_LANG, type Locale } from "@/i18n/routing";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { PeriodicView } from "@/components/briefing/periodic-view";
import { BriefingTabs, periodicPath } from "@/components/briefing/briefing-tabs";
import { absoluteUrl, publishedLanguageAlternates } from "@/lib/site";
import { beijingDate, isoWeekRange, monthRange } from "@/lib/metrics/period";
import { getPublishedPeriodic, getPublishedPeriodicLocales, type PublicPeriodic } from "@/lib/briefing/periodic/public";
import { withPeriodicFx } from "@/lib/fx/briefing";
import type { PeriodicKind } from "@/lib/briefing/periodic/types";
import { BRIEFING_PATH, safeJsonLd } from "@/lib/briefing/view";
import { organizationLd } from "@/lib/seo/jsonld";
import type { BriefingLocale } from "@/lib/briefing/types";

/*
 * /[locale]/briefing/weekly[/2026-W44] 와 /[locale]/briefing/monthly[/2026-10] 이 함께 쓰는 서버 렌더러·메타데이터 (Gate 2).
 * 공개는 발행본만. 리포트 문장은 MVP 에서 한국어판만 있으므로 en/zh 는 데일리와 같은 "언어판 없음" 안내로 간다.
 * canonical 은 언제나 기간 URL(/briefing/weekly/2026-W44, /briefing/monthly/2026-10).
 * 화면 틀 문구는 messages 의 "weekly" / "monthly" 이름공간 (월간 이름공간은 주간과 다른 문구만 둔다).
 */

export const weeklyPath = (week: string) => periodicPath("weekly", week);

type Resolved =
  | { kind: "ok"; report: PublicPeriodic }
  | { kind: "locale_missing"; key: string; locales: BriefingLocale[] }
  | { kind: "empty" }
  | { kind: "not_found" };

/** 형식이 맞고 이미 끝난 기간인가 (미래·진행 중인 기간은 404) */
export function isPublicPeriod(kind: PeriodicKind, key: string, today = beijingDate()): boolean {
  const r = kind === "weekly" ? isoWeekRange(key) : monthRange(key);
  return !!r && r.end < today;
}
export const isPublicWeek = (week: string) => isPublicPeriod("weekly", week);

const resolve = cache(async function resolve(kind: PeriodicKind, locale: string, key?: string): Promise<Resolved> {
  if (!isLocale(locale)) return { kind: "not_found" };
  if (key !== undefined && !isPublicPeriod(kind, key)) return { kind: "not_found" };
  const report = await getPublishedPeriodic(kind, locale, key);
  if (report) return { kind: "ok", report: await withPeriodicFx(report) };
  const other = await getPublishedPeriodicLocales(kind, key);
  if (other && other.locales.length) return { kind: "locale_missing", key: other.key, locales: other.locales };
  return key ? { kind: "not_found" } : { kind: "empty" };
});

/** NewsArticle: isBasedOn 인용 기사 상위 10건, creditText "AI 작성·편집자 검토" */
export function periodicJsonLd(w: PublicPeriodic, opts: { brand: string; title: string; credit: string }) {
  const url = absoluteUrl(w.locale, periodicPath(w.edition_type, w.period_key));
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
export const weeklyJsonLd = periodicJsonLd;

const TITLE_KEY = { weekly: "weeklyTitle", monthly: "monthlyTitle" } as const;
const LATEST_KEY = { weekly: "weeklyLatestTitle", monthly: "monthlyLatestTitle" } as const;
const DESC_KEY = { weekly: "weeklyDescription", monthly: "monthlyDescription" } as const;

export async function periodicMetadata(kind: PeriodicKind, locale: string, key?: string): Promise<Metadata> {
  const r = await resolve(kind, locale, key);
  const loc = isLocale(locale) ? locale : "ko";
  const t = await getTranslations({ locale: loc, namespace: "meta" });
  if (r.kind === "ok") {
    const w = r.report;
    const title = t(TITLE_KEY[kind], { week: w.period_key, month: w.period_key, headline: w.content.headline });
    const url = absoluteUrl(w.locale, periodicPath(kind, w.period_key));
    return {
      title: { absolute: title },
      description: w.content.dek,
      alternates: { canonical: url, languages: publishedLanguageAlternates(periodicPath(kind, w.period_key), w.available_locales) },
      // 페이지 openGraph 는 레이아웃 것을 통째로 덮으므로 사이트 이름·언어를 다시 넣는다 (데일리 QA C-08 과 같게)
      openGraph: {
        type: "article", title, description: w.content.dek, url, publishedTime: w.published_at || undefined,
        siteName: t("brand"), locale: LOCALE_HTML_LANG[w.locale as Locale].replace("-", "_"),
      },
      twitter: { card: "summary", title, description: w.content.dek },
    };
  }
  if (r.kind === "not_found") {
    return notFoundMetadata(loc);
  }
  return { title: t(LATEST_KEY[kind]), description: t(DESC_KEY[kind]), robots: { index: false, follow: true } };
}
export const weeklyMetadata = (locale: string, week?: string) => periodicMetadata("weekly", locale, week);

export async function PeriodicPageContent({ kind, locale, periodKey }: { kind: PeriodicKind; locale: string; periodKey?: string }) {
  const r = await resolve(kind, locale, periodKey);
  if (r.kind === "not_found") notFound();
  // 월간 이름공간은 주간과 같은 키 이름을 쓴다 (문구만 다름)
  const t = await getTranslations({ locale, namespace: kind as "weekly" });
  const tw = await getTranslations({ locale, namespace: "weekly" });
  const tb = await getTranslations({ locale, namespace: "briefing" });
  const tm = await getTranslations({ locale, namespace: "meta" });

  let body: React.ReactNode;
  if (r.kind === "ok") {
    const w = r.report;
    const jsonLd = periodicJsonLd(w, {
      brand: tm("brand"),
      title: tm(TITLE_KEY[kind], { week: w.period_key, month: w.period_key, headline: w.content.headline }),
      credit: tw("aiLabel"),
    });
    body = (
      <>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }} />
        <PeriodicView report={w} />
      </>
    );
  } else if (r.kind === "locale_missing") {
    body = (
      <section className="max-w-xl py-16" data-testid="weekly-locale-missing">
        <h1 className="text-2xl font-bold text-ink">{t("localeMissingTitle")}</h1>
        <p className="mt-3 text-ink-2">{t("localeMissingBody", { week: r.key, month: r.key })}</p>
        <ul className="mt-4 flex flex-wrap gap-4">
          {r.locales.map((l) => (
            <li key={l}>
              <Link
                href={periodicPath(kind, r.key)}
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
          {tw("backDaily")}
        </Link>
      </section>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main id="main" tabIndex={-1} className="scroll-mt-16 outline-none container mx-auto flex-1 px-4">
        <BriefingTabs current={kind} />
        {body}
      </main>
      <Footer />
    </div>
  );
}
