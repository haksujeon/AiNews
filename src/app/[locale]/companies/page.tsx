import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { isLocale } from "@/i18n/routing";
import { absoluteUrl, languageAlternates } from "@/lib/site";
import { Link } from "@/i18n/navigation";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { RegionFlag } from "@/components/news/region-flag";
import { CompanyBars } from "@/components/companies/company-charts";
import { EventList, SectionHead, changeLabel, shortDate } from "@/components/companies/company-parts";
import { fetchArticleTitles, getCompaniesSnapshot } from "@/lib/companies";
import { companyDirectory, companyName } from "@/lib/company-names";

/**
 * 기업·이슈 허브 (2026-11-03 메뉴 개편 4번째 메뉴). 데이터 = getCompaniesSnapshot (주간 리포트와 같은 함수, 1시간 캐시).
 * 최근 7일 대 그 전 7일 · 중국 대 해외 · 증감 최대/최소 · 많이 다뤄진 기업(차트) · 큰 이슈 · 기업 찾기.
 */
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "companies" });
  return {
    title: t("metaTitle"),
    description: t("metaDescription"),
    alternates: { canonical: absoluteUrl(locale, "/companies"), languages: languageAlternates("/companies") },
  };
}

export default async function CompaniesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = await getTranslations({ locale, namespace: "companies" });
  const s = await getCompaniesSnapshot();
  const w = s.window;
  const titles = await fetchArticleTitles(s.events.map((e) => e.primary_id));

  const byKey = new Map(s.companies.map((c) => [c.key, c]));
  const sumCn = s.companies.filter((c) => c.chinese).reduce((a, c) => a + c.cur, 0);
  const sumOv = s.companies.filter((c) => !c.chinese).reduce((a, c) => a + c.cur, 0);
  const cnPct = sumCn + sumOv ? Math.round((sumCn / (sumCn + sumOv)) * 100) : 0;
  const withChange = s.companies.filter((c) => c.change_pct != null);
  const rising = withChange.length ? withChange.reduce((a, c) => (c.change_pct! > a.change_pct! ? c : a)) : null;
  const falling = withChange.length ? withChange.reduce((a, c) => (c.change_pct! < a.change_pct! ? c : a)) : null;
  const dir = companyDirectory();

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main id="main" tabIndex={-1} className="scroll-mt-16 outline-none flex-1 container mx-auto px-4 py-8" data-testid="companies-hub">
        <h1 className="text-[26px] font-[800] tracking-[-0.02em] text-ink sm:text-[30px]">{t("title")}</h1>
        <p className="mt-2 max-w-3xl text-[14.5px] leading-relaxed text-ink-2">
          {t("lead", { start: shortDate(w.start, locale), end: shortDate(w.end, locale), total: w.total, prevTotal: w.prevTotal })}
        </p>
        {w.shareBasis && <p className="mt-1 text-[13px] text-ink-3">{t("shareNote")}</p>}

        {/* 요약 3칸 */}
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          <div className="rounded-md border border-rule bg-background p-5">
            <p className="font-mono text-xs font-semibold text-ink-3">{t("cnVsOverseas")}</p>
            <p className="mt-2 text-[28px] font-[300] leading-none tracking-[-0.03em] text-ink tabular-nums">
              {sumCn} <span className="text-base text-ink-3">:</span> {sumOv}
            </p>
            <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-surface" aria-hidden="true">
              <span className="cx-fill block h-full" style={{ width: `${cnPct}%`, background: "var(--chart-cn)" }} />
            </div>
            <p className="mt-2 text-[12.5px] text-ink-3">
              {t("chinese")} {cnPct}% · {t("overseas")} {100 - cnPct}% — {t("cnVsOverseasSub")}
            </p>
          </div>
          {[
            { label: t("rising"), c: rising, cls: "text-[var(--chart-cn)]" },
            { label: t("falling"), c: falling, cls: "text-[var(--chart-us)]" },
          ].map(({ label, c, cls }) => (
            <div key={label} className="rounded-md border border-rule bg-background p-5">
              <p className="font-mono text-xs font-semibold text-ink-3">{label}</p>
              {c ? (
                <Link href={`/companies/${c.key}`} className="group mt-2 block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <span className="flex items-center gap-2 text-[19px] font-[750] text-ink group-hover:underline">
                    {c.chinese && <RegionFlag code="CN" />}
                    {companyName(c.key, locale)}
                  </span>
                  <span className={`mt-1 block font-mono text-[22px] tabular-nums ${cls}`}>{changeLabel(c.change_pct)}</span>
                  <span className="text-[12.5px] text-ink-3">
                    {c.prev} → {c.cur}
                  </span>
                </Link>
              ) : (
                <p className="mt-2 text-[13px] text-ink-3">{t("noChange")}</p>
              )}
            </div>
          ))}
        </div>

        {/* 많이 다뤄진 기업 */}
        <section aria-labelledby="cx-top" className="mt-10">
          <SectionHead id="cx-top" title={t("topTitle")} sub={t("topSub")} />
          <CompanyBars rows={s.companies.map((c) => ({ key: c.key, name: companyName(c.key, locale), chinese: c.chinese, cur: c.cur, prev: c.prev }))} />
        </section>

        {/* 큰 이슈 */}
        <section aria-labelledby="cx-issues" className="mt-10">
          <SectionHead id="cx-issues" title={t("issuesTitle")} sub={t("issuesSub")} />
          {s.events.length ? (
            <EventList
              testId="companies-issues"
              events={s.events}
              titles={titles}
              locale={locale}
              range={{ start: w.start, end: w.end }}
              labels={{ sources: (n) => t("sourcesCount", { count: n }), articles: (n) => t("articlesCount", { count: n }) }}
            />
          ) : (
            <p className="text-[14px] text-ink-3">{t("noIssues")}</p>
          )}
        </section>

        {/* 기업 찾기 */}
        <section aria-labelledby="cx-dir" className="mt-10">
          <SectionHead id="cx-dir" title={t("directoryTitle")} sub={t("directorySub", { count: dir.length })} />
          {[true, false].map((cn) => (
            <div key={String(cn)} className="mb-5">
              <h3 className="mb-2 font-mono text-xs font-semibold text-ink-3">{cn ? t("chinese") : t("overseas")}</h3>
              <ul className="flex flex-wrap gap-2" data-testid={cn ? "companies-dir-cn" : "companies-dir-overseas"}>
                {dir
                  .filter((d) => d.chinese === cn)
                  .map((d) => {
                    const n = byKey.get(d.key)?.cur ?? 0;
                    return (
                      <li key={d.key}>
                        <Link
                          href={`/companies/${d.key}`}
                          className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-rule px-3 text-[13.5px] text-ink hover:border-ink-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {companyName(d.key, locale)}
                          <span className="font-mono text-[11.5px] text-ink-3 tabular-nums">{n}</span>
                        </Link>
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))}
        </section>
      </main>
      <Footer />
    </div>
  );
}
