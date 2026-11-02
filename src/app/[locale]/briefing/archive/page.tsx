import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { isLocale, LOCALE_HTML_LANG, routing } from "@/i18n/routing";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { formatDateGroup } from "@/lib/news-utils";
import { absoluteUrl } from "@/lib/site";
import { listPublishedEditions } from "@/lib/briefing/public";
import { BRIEFING_PATH } from "@/lib/briefing/view";
import { BriefingDateLink } from "@/components/briefing/briefing-date-link";

// 지난 판 목록. 발행된 판이 없으면 noindex.
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "meta" });
  const editions = await listPublishedEditions(locale, 1);
  const path = `${BRIEFING_PATH}/archive`;
  const languages: Record<string, string> = {};
  for (const l of routing.locales) languages[LOCALE_HTML_LANG[l]] = absoluteUrl(l, path);
  return {
    title: t("briefingArchiveTitle"),
    description: t("briefingArchiveDescription"),
    alternates: { canonical: absoluteUrl(locale, path), languages },
    ...(editions.length ? {} : { robots: { index: false, follow: true } }),
  };
}

export default async function BriefingArchivePage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const t = await getTranslations({ locale, namespace: "briefing" });
  const editions = await listPublishedEditions(locale);

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main id="main" className="container mx-auto flex-1 px-4 pb-16">
        <div className="flex items-baseline justify-between border-b-2 border-rule-strong pb-3 pt-8">
          <h1 className="text-2xl font-[740] tracking-[-0.02em] text-ink sm:text-3xl">{t("archiveTitle")}</h1>
          <span className="text-[13px] text-ink-3">{t("archiveCount", { count: editions.length })}</span>
        </div>
        {editions.length === 0 ? (
          <p className="py-12 text-ink-2" data-testid="archive-empty">
            {t("archiveEmpty")}
          </p>
        ) : (
          <ol className="max-w-3xl">
            {editions.map((e) => (
              <li key={e.edition_date} className="border-b border-rule py-5">
                <p className="text-[13px] text-ink-3">
                  <time dateTime={e.edition_date}>{formatDateGroup(e.edition_date, locale)}</time>
                  {" · "}
                  {t("storiesCount", { count: e.top_count })}
                </p>
                <h2 className="mt-1 text-[19px] font-bold leading-snug tracking-[-0.015em] text-ink sm:text-[21px]">
                  <BriefingDateLink
                    date={e.edition_date}
                    className="rounded-sm hover:underline hover:decoration-1 hover:underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {e.headline}
                  </BriefingDateLink>
                </h2>
                <p className="mt-1.5 line-clamp-2 text-[15px] leading-relaxed text-ink-2">{e.lede}</p>
              </li>
            ))}
          </ol>
        )}
      </main>
      <Footer />
    </div>
  );
}
