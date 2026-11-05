import { getTranslations } from "next-intl/server";
import { SubscribeLink } from "@/components/newsletter/subscribe-link";
import { ArrowRight } from "lucide-react";
import { Link } from "@/i18n/navigation";
import type { PublicBriefing } from "@/lib/briefing/public";
import { BRIEFING_PATH, briefingDatePath, formatShortDate } from "@/lib/briefing/view";
import { feedUrl } from "@/lib/feed";

/**
 * 소개 랜딩 (2026-11-03 사용자 결정: /about 을 랜딩으로, 아래에 기존 소개 본문).
 * 시안: Landing.dc.html (~/ainews-reports/home-ui-2026-11/REVIEW.md 4차). 사실만 쓴다 — 매체 6곳, 하루 3회 수집(회당 80건),
 * 00:10 브리핑, 독립 AI 검토 2회, 3개 언어. 기사 수·브리핑 미리보기는 실시간 값.
 * 어두운 띠(console) + 청자(jade-bright) — 라이트·다크 모두 같은 띠, 나머지는 사이트 토큰.
 */
const SOURCES = [
  { name: "量子位", key: "src_qbitai" },
  { name: "36氪", key: "src_36kr" },
  { name: "IT之家", key: "src_ithome" },
  { name: "虎嗅", key: "src_huxiu" },
  { name: "机器之心", key: "src_synced" },
  { name: "新智元", key: "src_xinzhiyuan" },
] as const;

const STEPS = [1, 2, 3, 4, 5] as const;

export async function Landing({ locale, briefing, total }: { locale: string; briefing: PublicBriefing | null; total: number }) {
  const t = await getTranslations({ locale, namespace: "landing" });
  const nf = new Intl.NumberFormat(locale === "zh" ? "zh-CN" : locale === "en" ? "en-US" : "ko-KR");
  const stats = [
    { value: "6", unit: t("statSourcesUnit"), label: t("statSources") },
    { value: "3", unit: t("statRunsUnit"), label: t("statRuns") },
    { value: nf.format(total), unit: t("statArticlesUnit"), label: t("statArticles") },
    { value: "3", unit: t("statLangsUnit"), label: t("statLangs") },
  ];
  const gets = [
    { href: "/", k: "getToday", title: "getTodayTitle", body: "getTodayBody" },
    { href: "/news", k: "getNews", title: "getNewsTitle", body: "getNewsBody" },
    { href: `${BRIEFING_PATH}/weekly`, k: "getReports", title: "getReportsTitle", body: "getReportsBody" },
  ] as const;

  return (
    <div data-testid="landing">
      {/* 히어로 */}
      <section className="bg-console text-white">
        <div className="container mx-auto flex flex-col gap-10 px-4 py-14 sm:py-20 lg:flex-row lg:items-center lg:gap-14">
          <div className="min-w-0 flex-1 space-y-6">
            <p className="font-mono text-[13px] text-jade-bright">{t("eyebrow")}</p>
            <h1 className="whitespace-pre-line text-[36px] font-[850] leading-[1.14] tracking-[-0.03em] sm:text-[52px] lg:text-[58px]">{t("heroTitle")}</h1>
            <p className="max-w-[36rem] text-[17px] leading-[1.75] text-white/75 sm:text-[19px]">{t("heroBody")}</p>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/"
                className="inline-flex min-h-[52px] items-center gap-2 rounded-md bg-jade-bright px-6 text-[17px] font-bold text-console focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                {t("ctaToday")}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href="/news"
                className="inline-flex min-h-[52px] items-center rounded-md border border-white/25 px-6 text-[17px] text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                {t("ctaNews")}
              </Link>
            </div>
          </div>
          {briefing && (
            <Link
              href={briefingDatePath(briefing.edition_date)}
              className="block w-full shrink-0 rounded-[10px] border border-white/10 bg-white/[0.04] p-6 transition-colors hover:border-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-jade-bright lg:w-[440px]"
              data-testid="landing-preview"
            >
              <p className="flex items-center gap-2 font-mono text-xs text-jade-bright">
                <span aria-hidden="true" className="h-2 w-2 rounded-full bg-jade-bright" />
                DAILY BRIEFING · {formatShortDate(briefing.edition_date, locale)}
              </p>
              <p className="mt-3 text-[22px] font-[850] leading-snug">{briefing.content.headline}</p>
              <ol className="mt-4 space-y-2.5 text-[14.5px] text-white/80">
                {briefing.content.top_stories.slice(0, 3).map((s) => (
                  <li key={s.rank} className="flex gap-3">
                    <span aria-hidden="true" className="font-mono text-jade-bright">
                      {String(s.rank).padStart(2, "0")}
                    </span>
                    <span>{s.title}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-5 flex flex-wrap gap-2 font-mono text-[11px] text-white/55">
                <span className="rounded-[3px] border border-white/15 px-2 py-0.5">
                  {t("previewCoverage", {
                    total: briefing.content.meta?.candidate_count ?? 0,
                    cited: briefing.content.meta?.cited_count ?? Object.keys(briefing.articles).length,
                  })}
                </span>
                <span className="rounded-[3px] border border-white/15 px-2 py-0.5">{t("previewReviewed")}</span>
                <span className="rounded-[3px] border border-white/15 px-2 py-0.5">{t("previewSources")}</span>
              </p>
            </Link>
          )}
        </div>
      </section>

      {/* 숫자 띠 */}
      <section className="border-b border-rule bg-surface">
        <dl className="container mx-auto grid grid-cols-2 gap-6 px-4 py-8 lg:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label}>
              <dd className="font-mono text-[30px] font-semibold leading-tight text-ink sm:text-[34px]">
                {s.value}
                <span className="text-base text-ink-3">{s.unit}</span>
              </dd>
              <dt className="mt-1 text-sm text-ink-2">{s.label}</dt>
            </div>
          ))}
        </dl>
      </section>

      {/* 출처 */}
      <section className="container mx-auto space-y-5 px-4 py-14 sm:py-16" aria-labelledby="landing-sources">
        <p className="font-mono text-[13px] text-jade">{t("sourcesKicker")}</p>
        <h2 id="landing-sources" className="text-[28px] font-[850] tracking-[-0.02em] text-ink sm:text-[34px]">
          {t("sourcesTitle")}
        </h2>
        <p className="max-w-[40rem] text-[16.5px] leading-[1.7] text-ink-2">{t("sourcesBody")}</p>
        <ul className="grid grid-cols-2 gap-3 pt-2 sm:grid-cols-3 lg:grid-cols-6">
          {SOURCES.map((s) => (
            <li key={s.name} className="rounded-lg border border-rule bg-background p-4">
              <p lang="zh-CN" className="font-han text-[22px] font-bold text-ink">
                {s.name}
              </p>
              <p className="mt-1 text-xs text-ink-3">{t(s.key)}</p>
            </li>
          ))}
        </ul>
      </section>

      {/* 만드는 과정 */}
      <section className="bg-console text-white" aria-labelledby="landing-how">
        <div className="container mx-auto space-y-6 px-4 py-14 sm:py-16">
          <p className="font-mono text-[13px] text-jade-bright">{t("howKicker")}</p>
          <h2 id="landing-how" className="text-[28px] font-[850] tracking-[-0.02em] sm:text-[34px]">
            {t("howTitle")}
          </h2>
          <ol className="grid gap-3 md:grid-cols-5">
            {STEPS.map((n) => (
              <li key={n} className="flex flex-col gap-2.5 rounded-[10px] border border-white/10 bg-white/[0.04] p-5">
                <p className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-[26px] font-semibold text-jade-bright">{String(n).padStart(2, "0")}</span>
                  <span className="font-mono text-[11px] text-white/55">{t(`step${n}When`)}</span>
                </p>
                <h3 className="text-[18px] font-[850]">{t(`step${n}Title`)}</h3>
                <p className="text-[14px] leading-[1.65] text-white/70">{t(`step${n}Body`)}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* 볼거리 */}
      <section className="container mx-auto space-y-6 px-4 py-14 sm:py-16" aria-labelledby="landing-get">
        <p className="font-mono text-[13px] text-jade">{t("getKicker")}</p>
        <h2 id="landing-get" className="text-[28px] font-[850] tracking-[-0.02em] text-ink sm:text-[34px]">
          {t("getTitle")}
        </h2>
        <ul className="grid gap-4 md:grid-cols-3">
          {gets.map((g) => (
            <li key={g.k}>
              <Link
                href={g.href}
                className="flex h-full flex-col gap-2 rounded-[10px] border border-rule bg-background p-6 transition-colors hover:border-ink-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="font-mono text-xs text-jade">{t(g.k)}</span>
                <span className="text-[18px] font-[850] text-ink">{t(g.title)}</span>
                <span className="text-[14px] leading-[1.6] text-ink-2">{t(g.body)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* 신뢰 */}
      <section className="bg-jade-weak" aria-labelledby="landing-trust">
        <div className="container mx-auto space-y-6 px-4 py-14 sm:py-16">
          <p className="font-mono text-[13px] text-jade">{t("trustKicker")}</p>
          <h2 id="landing-trust" className="text-[28px] font-[850] tracking-[-0.02em] text-ink sm:text-[34px]">
            {t("trustTitle")}
          </h2>
          <ul className="grid gap-4 md:grid-cols-3">
            {[1, 2, 3].map((n) => (
              <li key={n} className="rounded-[10px] bg-background p-6">
                <p className="text-[18px] font-[850] text-ink">{t(`trust${n}Title`)}</p>
                <p className="mt-2 text-[14px] leading-[1.7] text-ink-2">{t(`trust${n}Body`)}</p>
              </li>
            ))}
          </ul>
          <p className="flex flex-wrap gap-5 text-[15px] font-bold">
            <Link href="/methodology" className="rounded-sm text-jade hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t("trustMethod")} →
            </Link>
            <Link href="/corrections" className="rounded-sm text-jade hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {t("trustCorrections")} →
            </Link>
          </p>
        </div>
      </section>

      {/* 구독 */}
      <section className="container mx-auto flex flex-wrap items-center gap-5 px-4 py-14">
        <div className="min-w-[260px] flex-1">
          <h2 className="text-[26px] font-[850] tracking-[-0.02em] text-ink sm:text-[30px]">{t("subTitle")}</h2>
          <p className="mt-1.5 text-[15.5px] text-ink-2">{t("subBody")}</p>
        </div>
        <SubscribeLink source="landing" variant="button" className="min-h-[52px] px-6 text-[16px]" />
        <Link href="/" className="inline-flex min-h-[52px] items-center rounded-md bg-ink px-6 text-[16px] font-bold text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {t("ctaToday")}
        </Link>
        <a
          href={feedUrl(locale, { kind: "all" })}
          className="inline-flex min-h-[52px] items-center rounded-md border border-rule px-6 text-[16px] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("subRss")}
        </a>
      </section>
    </div>
  );
}
