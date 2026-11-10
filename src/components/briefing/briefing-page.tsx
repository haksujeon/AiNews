import type { Metadata } from "next";
import { cache } from "react";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { notFoundMetadata } from "@/lib/seo/not-found-meta";
import { Link } from "@/i18n/navigation";
import { isLocale } from "@/i18n/routing";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { BriefingView } from "@/components/briefing/briefing-view";
import { BriefingTabs } from "@/components/briefing/briefing-tabs";
import { BriefingDateLink } from "@/components/briefing/briefing-date-link";
import { absoluteUrl } from "@/lib/site";
import { formatDate } from "@/lib/news-utils";
import { isValidEditionDate } from "@/lib/briefing/generate";
import { getAdjacentEditions, getPublishedBriefing, getPublishedLocales, type PublicBriefing } from "@/lib/briefing/public";
import { loadCardSpec } from "@/lib/briefing/media-store";
import { withFxNotes } from "@/lib/fx/briefing";
import { briefingAlternates, briefingDatePath, briefingJsonLd, formatShortDate, safeJsonLd } from "@/lib/briefing/view";
import type { BriefingLocale } from "@/lib/briefing/types";
import { LOCALE_HTML_LANG } from "@/i18n/routing";

/*
 * /[locale]/briefing (최신 판) 와 /[locale]/briefing/[date] 가 함께 쓰는 서버 렌더러·메타데이터.
 * 두 경로 모두 getPublishedBriefing() 하나로 읽는다 (Gate 2). canonical 은 언제나 날짜 URL.
 */

type Resolved =
  | { kind: "ok"; briefing: PublicBriefing }
  | { kind: "locale_missing"; date: string; locales: BriefingLocale[] }
  | { kind: "empty" }
  | { kind: "not_found" };

// 메타데이터와 본문이 같은 요청에서 한 번만 읽도록 cache
const resolve = cache(async function resolve(locale: string, date?: string): Promise<Resolved> {
  if (!isLocale(locale)) return { kind: "not_found" };
  if (date !== undefined && !isValidEditionDate(date)) return { kind: "not_found" };
  const briefing = await getPublishedBriefing(locale, date);
  if (briefing) return { kind: "ok", briefing };
  // 요청한 언어판은 없지만 다른 언어판이 있으면 안내 (500 이 아니라 안내 화면)
  const other = await getPublishedLocales(date);
  if (other && other.locales.length) return { kind: "locale_missing", date: other.date, locales: other.locales };
  return date ? { kind: "not_found" } : { kind: "empty" };
});

function headlineTitle(b: PublicBriefing, template: (v: { date: string; headline: string }) => string) {
  return template({ date: formatShortDate(b.edition_date, b.locale), headline: b.content.headline });
}

export async function briefingMetadata(locale: string, date?: string): Promise<Metadata> {
  const r = await resolve(locale, date);
  const loc = isLocale(locale) ? locale : "ko";
  const t = await getTranslations({ locale: loc, namespace: "meta" });
  if (r.kind === "ok") {
    const b = r.briefing;
    const title = headlineTitle(b, (v) => t("briefingTitle", v));
    const url = absoluteUrl(b.locale, briefingDatePath(b.edition_date));
    return {
      // 레이아웃 템플릿("%s | SDSC AI NEWS")을 거치지 않고 그대로
      title: { absolute: title },
      description: b.content.lede,
      alternates: { canonical: url, languages: briefingAlternates(b.edition_date, b.available_locales) },
      // 페이지 openGraph 는 레이아웃 것을 통째로 덮으므로 사이트 이름·언어를 다시 넣는다 (QA C-08)
      openGraph: { type: "article", title, description: b.content.lede, url, publishedTime: b.published_at || undefined, siteName: t("brand"), locale: LOCALE_HTML_LANG[loc].replace("-", "_") },
      twitter: { card: "summary", title, description: b.content.lede },
    };
  }
  if (r.kind === "not_found") {
    return notFoundMetadata(loc);
  }
  // 언어판 없음 / 아직 발행 전: 색인하지 않는다
  return { title: t("briefingLatestTitle"), robots: { index: false, follow: true } };
}

export async function BriefingPageContent({ locale, date }: { locale: string; date?: string }) {
  const r = await resolve(locale, date);
  if (r.kind === "not_found") notFound();
  const t = await getTranslations({ locale, namespace: "briefing" });
  const tm = await getTranslations({ locale, namespace: "meta" });

  let body: React.ReactNode;
  if (r.kind === "ok") {
    // 금액 환산 표기는 화면에서만 붙인다 (메타데이터·카드·음성은 원래 금액) — fx/briefing.ts, 아침 메일과 같은 함수
    const [b, pager, cardSpec] = await Promise.all([
      withFxNotes(r.briefing),
      getAdjacentEditions(r.briefing.locale, r.briefing.edition_date),
      loadCardSpec(r.briefing.edition_date, r.briefing.locale),
    ]);
    const jsonLd = briefingJsonLd(b, { brand: tm("brand"), title: headlineTitle(b, (v) => tm("briefingTitle", v)) });
    body = (
      <>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }} />
        <BriefingView briefing={b} pager={pager} cardSpec={cardSpec} />
      </>
    );
  } else if (r.kind === "locale_missing") {
    body = (
      <section className="max-w-xl py-16" data-testid="briefing-locale-missing">
        <h1 className="text-2xl font-bold text-ink">{t("localeMissingTitle")}</h1>
        <p className="mt-3 text-ink-2">{t("localeMissingBody", { date: formatDate(r.date, locale) })}</p>
        <ul className="mt-4 flex flex-wrap gap-4">
          {r.locales.map((l) => (
            <li key={l}>
              <BriefingDateLink
                date={r.date}
                locale={l}
                className="rounded-sm font-medium text-ink underline decoration-1 underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t(`langName_${l}`)}
              </BriefingDateLink>
            </li>
          ))}
        </ul>
      </section>
    );
  } else {
    body = (
      <section className="max-w-xl py-16" data-testid="briefing-empty">
        <h1 className="text-2xl font-bold text-ink">{t("emptyTitle")}</h1>
        <p className="mt-3 text-ink-2">{t("emptyBody")}</p>
        <Link href="/" className="mt-4 inline-block font-medium text-ink underline underline-offset-4">
          {t("backHome")}
        </Link>
      </section>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main id="main" tabIndex={-1} className="scroll-mt-16 outline-none container mx-auto flex-1 px-4">
        <BriefingTabs current="daily" />
        {body}
      </main>
      <Footer />
    </div>
  );
}
