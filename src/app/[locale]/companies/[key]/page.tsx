import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, Search } from "lucide-react";
import { isLocale } from "@/i18n/routing";
import { absoluteUrl, languageAlternates } from "@/lib/site";
import { Link } from "@/i18n/navigation";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { RegionFlag } from "@/components/news/region-flag";
import { CoBars, CompanyTrend } from "@/components/companies/company-charts";
import { EventList, SectionHead, changeLabel, shortDate } from "@/components/companies/company-parts";
import { CO_DAYS, briefingAppearances, fetchArticleTitles, getCompaniesSnapshot } from "@/lib/companies";
import { companyEntity, companyName, isCompanyKey } from "@/lib/company-names";
import { briefingDatePath } from "@/lib/briefing/view";
import { addDays } from "@/lib/metrics/period";

/**
 * 기업 페이지 (/companies/[key], key = 이름표 ENTITIES.key). 모르는 키는 404, 아는 키인데 최근 기사가 없으면 "기사 없음"으로 그린다.
 * 머리 숫자 · 주별 100건당 언급(수집 미완 주 점선) · 함께 언급 · 최근 이슈 · 기사 검색(/news?q= — 집계와 방식이 달라 건수를 붙이지 않는다).
 */
export async function generateMetadata({ params }: { params: Promise<{ locale: string; key: string }> }): Promise<Metadata> {
  const { locale, key } = await params;
  if (!isCompanyKey(key)) return {};
  const t = await getTranslations({ locale, namespace: "companies" });
  const name = companyName(key, locale);
  return {
    title: t("companyMetaTitle", { name }),
    description: t("companyMetaDescription", { name }),
    alternates: { canonical: absoluteUrl(locale, `/companies/${key}`), languages: languageAlternates(`/companies/${key}`) },
  };
}

export default async function CompanyPage({ params }: { params: Promise<{ locale: string; key: string }> }) {
  const { locale, key } = await params;
  if (!isLocale(locale) || !isCompanyKey(key)) notFound();
  const t = await getTranslations({ locale, namespace: "companies" });
  const e = companyEntity(key)!;
  const name = companyName(key, locale);
  const [s, app] = await Promise.all([getCompaniesSnapshot(), briefingAppearances(key, locale)]);
  const w = s.window;
  const c = s.companies.find((x) => x.key === key);
  const events = s.recentEvents.filter((ev) => ev.entities.includes(key)).slice(0, 6);
  const titles = await fetchArticleTitles(events.map((ev) => ev.primary_id));
  const points = s.weeks.map((wk) => ({
    label: shortDate(wk.start, locale),
    value: wk.total ? Math.round(((wk.counts[key] ?? 0) / wk.total) * 1000) / 10 : 0,
    count: wk.counts[key] ?? 0,
    total: wk.total,
    incomplete: wk.incomplete,
  }));
  const co = (s.co[key] ?? []).map((r) => ({ key: r.key, n: r.n, name: companyName(r.key, locale), chinese: companyEntity(r.key)?.chinese ?? false }));
  const coStart = addDays(w.end, -(CO_DAYS - 1));

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main id="main" tabIndex={-1} className="scroll-mt-16 outline-none flex-1 container mx-auto px-4 py-8" data-testid="company-page">
        <Link href="/companies" className="inline-flex min-h-9 items-center gap-1.5 text-[13.5px] text-ink-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          {t("back")}
        </Link>
        <h1 className="mt-2 flex items-center gap-2.5 text-[28px] font-[800] tracking-[-0.02em] text-ink sm:text-[34px]">
          {e.chinese && <RegionFlag code="CN" className="h-[15px] w-[22px]" />}
          {name}
        </h1>

        {/* 머리 숫자 */}
        <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3" data-testid="company-stats">
          <div className="rounded-md border border-rule bg-background p-4">
            <dt className="font-mono text-xs font-semibold text-ink-3">{t("recentCount")}</dt>
            {c ? (
              <dd className="mt-1.5">
                <span className="text-[30px] font-[300] leading-none tracking-[-0.03em] text-ink tabular-nums">{c.cur}</span>
                <span className="ml-2 font-mono text-[14px] text-ink-2">{changeLabel(c.change_pct)}</span>
                <span className="mt-1 block text-[12.5px] text-ink-3">{t("vsPrev", { prev: c.prev })}</span>
              </dd>
            ) : (
              <dd className="mt-2 text-[14px] text-ink-2">{t("noArticles")}</dd>
            )}
          </div>
          <div className="rounded-md border border-rule bg-background p-4">
            <dt className="font-mono text-xs font-semibold text-ink-3">{t("sources")}</dt>
            <dd className="mt-1.5 text-[30px] font-[300] leading-none tracking-[-0.03em] text-ink tabular-nums">{t("sourcesValue", { count: c?.sources ?? 0 })}</dd>
          </div>
          <div className="col-span-2 rounded-md border border-rule bg-background p-4 sm:col-span-1">
            <dt className="font-mono text-xs font-semibold text-ink-3">{t("briefings")}</dt>
            <dd className="mt-1.5">
              <span className="text-[30px] font-[300] leading-none tracking-[-0.03em] text-ink tabular-nums">{t("briefingsValue", { n: app.dates.length, total: app.total })}</span>
              {app.dates.length > 0 && (
                <span className="mt-1.5 flex flex-wrap gap-x-2 text-[12.5px]">
                  {app.dates.map((d) => (
                    <Link key={d} href={briefingDatePath(d)} className="text-jade underline-offset-2 hover:underline">
                      {shortDate(d, locale)}
                    </Link>
                  ))}
                </span>
              )}
            </dd>
          </div>
        </dl>
        {w.shareBasis && <p className="mt-2 text-[12.5px] text-ink-3">{t("shareNote")}</p>}

        <div className="mt-10 grid gap-10 lg:grid-cols-[3fr_2fr]">
          <section aria-labelledby="co-trend" className="min-w-0">
            <SectionHead id="co-trend" title={t("trendTitle")} sub={t("trendSub")} />
            <CompanyTrend points={points} name={name} />
          </section>
          <section aria-labelledby="co-with" className="min-w-0">
            <SectionHead id="co-with" title={t("coTitle")} sub={t("coSub", { days: CO_DAYS, base: s.coBase[key] ?? 0 })} />
            {co.length ? (
              <>
                <CoBars rows={co} />
                <ul className="sr-only">
                  {co.map((r) => (
                    <li key={r.key}>
                      <Link href={`/companies/${r.key}`}>
                        {r.name} {r.n}
                      </Link>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-[14px] text-ink-3">{t("noCo")}</p>
            )}
          </section>
        </div>

        <section aria-labelledby="co-events" className="mt-10">
          <SectionHead id="co-events" title={t("eventsTitle")} sub={t("eventsSub", { days: CO_DAYS })} />
          {events.length ? (
            <EventList
              testId="company-events"
              events={events}
              titles={titles}
              locale={locale}
              range={{ start: coStart, end: w.end }}
              labels={{ sources: (n) => t("sourcesCount", { count: n }), articles: (n) => t("articlesCount", { count: n }) }}
            />
          ) : (
            <p className="text-[14px] text-ink-3">{t("noIssues")}</p>
          )}
        </section>

        <div className="mt-8">
          <Link
            href={`/news?q=${encodeURIComponent(name)}`}
            className="inline-flex min-h-10 items-center gap-2 rounded-md border border-ink px-4 text-[14px] font-semibold text-ink hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            data-testid="company-search"
          >
            <Search className="h-4 w-4" aria-hidden="true" />
            {t("searchLink", { name })}
          </Link>
          <p className="mt-1.5 text-[12.5px] text-ink-3">{t("searchHint")}</p>
        </div>
      </main>
      <Footer />
    </div>
  );
}
