import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { isLocale, LOCALE_HTML_LANG } from "@/i18n/routing";
import { LEGAL_VARS, TrustPage, trustMetadata } from "@/components/trust/trust-page";
import { Markdown } from "@/lib/trust/markdown";
import { loadLegal } from "@/lib/trust/content";
import { formatDateGroup } from "@/lib/news-utils";
import { listCorrections, resolveCorrectionsSince } from "@/lib/briefing/corrections";
import { BriefingDateLink } from "@/components/briefing/briefing-date-link";

// 정정 기록은 DB 를 읽는다 — 빌드 시점 스냅샷이 되지 않게 요청마다 그린다
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return isLocale(locale) ? trustMetadata(locale, "corrections") : {};
}

function formatTime(iso: string, locale: string): string {
  return new Intl.DateTimeFormat(LOCALE_HTML_LANG[locale as keyof typeof LOCALE_HTML_LANG] ?? locale, {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).format(new Date(iso));
}

/** cutoff ISO → KST 날짜(YYYY-MM-DD) */
const kstDate = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10);

export default async function CorrectionsPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const since = await resolveCorrectionsSince();
  const [source, t, items] = await Promise.all([
    loadLegal(locale, "corrections"),
    getTranslations({ locale, namespace: "trust" }),
    listCorrections(locale, since),
  ]);

  return (
    <TrustPage
      locale={locale}
      pageKey="corrections"
      meta={since ? t("correctionsSince", { date: formatDateGroup(kstDate(since), locale) }) : t("correctionsSinceNone")}
    >
      <Markdown source={source} vars={LEGAL_VARS} />
      {items.length === 0 ? (
        <p className="mt-10 max-w-3xl border-y border-rule py-8 text-ink-2" data-testid="corrections-empty">
          {t("correctionsEmpty")}
        </p>
      ) : (
        <ol className="mt-8 max-w-3xl border-t border-rule" aria-label={t("correctionsListLabel")} data-testid="corrections-list">
          {items.map((c) => (
            <li key={c.id} className="border-b border-rule py-5" data-testid="correction-item">
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-3">
                <span className="rounded-sm border border-rule-strong px-1.5 py-px text-[12px] font-semibold text-ink">
                  {t(`kind_${c.kind}`)}
                </span>
                <span>{t("versionLabel", { version: c.version })}</span>
                <span aria-hidden>·</span>
                <time dateTime={c.published_at}>{t("publishedAt", { time: formatTime(c.published_at, locale) })}</time>
                <span aria-hidden>·</span>
                <time dateTime={c.changed_at}>{t("changedAt", { time: formatTime(c.changed_at, locale) })}</time>
              </p>
              <h2 className="mt-1.5 text-[18px] font-bold leading-snug tracking-[-0.015em] text-ink sm:text-[19px]">
                {c.edition_type === "weekly"
                  ? t("editionWeekly", { week: c.edition_label })
                  : c.edition_type === "monthly"
                    ? t("editionMonthly", { month: c.edition_label })
                  : t("editionDaily", { date: formatDateGroup(c.edition_date, locale) })}
              </h2>
              <p className="mt-1.5 text-[15px] leading-relaxed text-ink-2">
                <span className="font-semibold text-ink">{t("reasonLabel")}: </span>
                {c.reason ?? (c.kind === "superseded" ? t("reasonSuperseded") : t("reasonMissing"))}
              </p>
              <p className="mt-1.5 text-[14px]">
                {c.replacement && c.edition_type === "daily" ? (
                  // 데일리 대체판은 브리핑 판 사이 링크 — 전체 이동 (BriefingDateLink)
                  <BriefingDateLink
                    path={c.replacement.path}
                    className="rounded-sm text-jade underline decoration-1 underline-offset-4 hover:decoration-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t("viewReplacement", { version: c.replacement.version })}
                  </BriefingDateLink>
                ) : c.replacement ? (
                  <Link
                    href={c.replacement.path}
                    className="rounded-sm text-jade underline decoration-1 underline-offset-4 hover:decoration-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {t("viewReplacement", { version: c.replacement.version })}
                  </Link>
                ) : (
                  <span className="text-ink-3">{t("noReplacement")}</span>
                )}
              </p>
            </li>
          ))}
        </ol>
      )}
    </TrustPage>
  );
}
