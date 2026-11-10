import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import pool from "@/lib/db";
import { isLocale } from "@/i18n/routing";
import { isPublicPeriod } from "@/components/briefing/periodic-page";
import { periodStartOf } from "@/lib/briefing/periodic/public";
import type { PeriodicKind } from "@/lib/briefing/periodic/types";
import { isoWeekRange, monthRange } from "@/lib/metrics/period";
import { formatDate } from "@/lib/news-utils";
import { renderOgCard, siteLabel } from "@/lib/seo/og-card";
import { rootUrl } from "@/lib/site";

/**
 * 주간·월간 리포트 공유 카드 (2026-11-10 사용자 결정: 주간·월간도 데일리 개선 반영). 데일리 카드와 같은 renderOgCard.
 * 발행본이 있으면 그 언어 헤드라인, 없으면 "주간 리포트 2026-W45" 같은 기본 문구.
 */
export async function renderPeriodicOg(kind: PeriodicKind, locale: string, key: string) {
  if (!isLocale(locale) || !isPublicPeriod(kind, key)) notFound();
  const start = periodStartOf(kind, key);
  const range = kind === "weekly" ? isoWeekRange(key) : monthRange(key);
  const [{ rows }, tm, tk] = await Promise.all([
    pool.query(
      `SELECT content->>'headline' AS headline FROM daily_briefings
        WHERE edition_type = $1 AND edition_date = $2::date AND locale = $3 AND status = 'published' LIMIT 1`,
      [kind, start, locale]
    ),
    getTranslations({ locale, namespace: "meta" }),
    getTranslations({ locale, namespace: kind as "weekly" }),
  ]);
  const kicker = tk("kicker");
  return renderOgCard({
    locale,
    brand: tm("brand"),
    kicker,
    title: (rows[0]?.headline as string | undefined) || `${kicker} ${key}`,
    meta: range ? [`${formatDate(range.start, locale)} ~ ${formatDate(range.end, locale)}`] : [],
    site: siteLabel(rootUrl()),
  });
}
