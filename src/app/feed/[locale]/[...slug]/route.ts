import { getTranslations } from "next-intl/server";
import { routing, type Locale } from "@/i18n/routing";
import { buildRss, FEED_CATEGORIES, FEED_LANGUAGE, FEED_MAX_ITEMS, feedUrl, parseFeedSlug, type FeedItem, type FeedKind } from "@/lib/feed";
import { listFeedNews } from "@/lib/seo/data";
import { getCategoryLabel, getSummary, getTitle } from "@/lib/news-utils";
import { absoluteUrl } from "@/lib/site";
import { listPublishedEditions } from "@/lib/briefing/public";
import { listPublishedPeriodics } from "@/lib/briefing/periodic/public";
import { BRIEFING_PATH, briefingDatePath, formatShortDate } from "@/lib/briefing/view";
import { periodicPath } from "@/components/briefing/briefing-tabs";

/*
 * RSS 2.0 (P0-2): /ainews/feed/{ko|en|zh}/all.xml · briefing.xml · category/{분류}.xml
 * [locale] 밖에 두고 경로에 "." 이 있어 next-intl 미들웨어(로케일 협상·리다이렉트)를 거치지 않는다.
 * 항목: 제목 + 요약(getSummary, 300자 이하) + 링크. 번역 전문·content:encoded 는 싣지 않는다.
 */
export const revalidate = 3600;

/** 피드 15종(언어 3 × 전체·브리핑·분류 3)을 빌드 때 만들고 한 시간마다 다시 만든다. 그 밖의 경로는 404 */
export const dynamicParams = false;
export function generateStaticParams() {
  return routing.locales.flatMap((locale) => [
    { locale, slug: ["all.xml"] },
    { locale, slug: ["briefing.xml"] },
    ...FEED_CATEGORIES.map((c) => ({ locale, slug: ["category", `${c}.xml`] })),
  ]);
}

interface Ctx {
  params: Promise<{ locale: string; slug: string[] }>;
}

async function newsItems(locale: Locale, category?: string): Promise<FeedItem[]> {
  const rows = await listFeedNews(FEED_MAX_ITEMS, category);
  return rows.map((r) => ({
    title: getTitle(r, locale),
    link: absoluteUrl(locale, `/news/${r.id}`),
    description: getSummary(r, locale),
    pubDate: r.news_date ?? r.created_at,
    category: r.category ? getCategoryLabel(r.category, locale) : null,
  }));
}

async function briefingItems(locale: Locale): Promise<FeedItem[]> {
  const tm = await getTranslations({ locale, namespace: "meta" });
  const ts = await getTranslations({ locale, namespace: "seo" });
  const [daily, weekly, monthly] = await Promise.all([
    listPublishedEditions(locale, FEED_MAX_ITEMS),
    listPublishedPeriodics("weekly", FEED_MAX_ITEMS * 3),
    listPublishedPeriodics("monthly", FEED_MAX_ITEMS * 3),
  ]);
  const items: (FeedItem & { sort: string })[] = [
    ...daily.map((e) => ({
      title: tm("briefingTitle", { date: formatShortDate(e.edition_date, locale), headline: e.headline }),
      link: absoluteUrl(locale, briefingDatePath(e.edition_date)),
      description: e.lede,
      pubDate: `${e.edition_date}T00:00:00+08:00`,
      sort: `${e.edition_date}T00:00:00+08:00`,
    })),
    ...[...weekly, ...monthly]
      .filter((w) => w.locale === locale)
      .map((w) => ({
        title:
          w.edition_type === "monthly"
            ? ts("monthlyItemTitle", { month: w.key, headline: w.headline })
            : ts("weeklyItemTitle", { week: w.key, headline: w.headline }),
        link: absoluteUrl(locale, periodicPath(w.edition_type, w.key)),
        description: w.dek,
        pubDate: w.published_at,
        sort: w.published_at ?? "",
      })),
  ];
  return items
    .sort((a, b) => Date.parse(b.sort || "0") - Date.parse(a.sort || "0"))
    .slice(0, FEED_MAX_ITEMS)
    .map((i) => ({ title: i.title, link: i.link, description: i.description, pubDate: i.pubDate }));
}

async function channelText(locale: Locale, feed: FeedKind) {
  const t = await getTranslations({ locale, namespace: "seo" });
  if (feed.kind === "briefing") return { title: t("feedBriefingTitle"), description: t("feedBriefingDescription"), link: absoluteUrl(locale, BRIEFING_PATH) };
  if (feed.kind === "category") {
    const category = getCategoryLabel(feed.category, locale);
    return { title: t("feedCategoryTitle", { category }), description: t("feedCategoryDescription", { category }), link: absoluteUrl(locale) };
  }
  return { title: t("feedAllTitle"), description: t("feedAllDescription"), link: absoluteUrl(locale) };
}

export async function GET(_req: Request, ctx: Ctx) {
  const { locale, slug } = await ctx.params;
  const feed = parseFeedSlug(locale, slug);
  if (!feed) return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const loc = locale as Locale;

  const [channel, items] = await Promise.all([
    channelText(loc, feed),
    feed.kind === "briefing" ? briefingItems(loc) : newsItems(loc, feed.kind === "category" ? feed.category : undefined),
  ]);
  const xml = buildRss({ ...channel, language: FEED_LANGUAGE[loc], selfUrl: feedUrl(loc, feed) }, items);
  return new Response(xml, { headers: { "Content-Type": "application/rss+xml; charset=utf-8" } });
}
