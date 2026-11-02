/**
 * sitemap 항목 만들기 (서버 전용, P0-2).
 *  - 파일 0: 정적 페이지(신뢰 페이지 포함) + 발행된 데일리 브리핑·주간 리포트 (발행된 언어판만, hreflang 은 화면과 같은 함수)
 *  - 파일 1..N: 공개 기사(PUBLIC_NEWS_WHERE) SITEMAP_ARTICLES_PER_FILE 건씩, 언어 3개 URL + hreflang(x-default 포함)
 * /sitemap.xml 은 이 파일들을 가리키는 sitemapindex (src/app/sitemap.xml/route.ts). 직렬화는 sitemap-xml.ts.
 */
import { routing } from "@/i18n/routing";
import { absoluteUrl, languageAlternates, publishedLanguageAlternates, rootUrl } from "@/lib/site";
import { listPublishedEditions } from "@/lib/briefing/public";
import { listPublishedWeeklies } from "@/lib/briefing/periodic/public";
import { BRIEFING_PATH, briefingDatePath } from "@/lib/briefing/view";
import { WEEKLY_PATH } from "@/components/briefing/briefing-tabs";
import { countPublicNews, listSitemapNews, SITEMAP_ARTICLES_PER_FILE } from "@/lib/seo/data";
import { TRUST_PAGES } from "@/lib/trust/pages";
import type { SitemapEntry as Entry } from "@/lib/seo/sitemap-xml";

/** 파일 id 목록: 0(페이지·브리핑) + 기사 파일 수 */
export async function sitemapIds(): Promise<number[]> {
  const n = await countPublicNews();
  const files = Math.max(1, Math.ceil(n / SITEMAP_ARTICLES_PER_FILE));
  return Array.from({ length: files + 1 }, (_, i) => i);
}

export function sitemapFileUrl(id: number): string {
  return rootUrl(`/sitemap/${id}.xml`);
}

/** 모든 언어에 있는 페이지: 언어마다 한 항목, 서로를 hreflang 으로 가리킨다 */
function allLocales(path: string, extra: Partial<Entry> = {}): Entry[] {
  const languages = languageAlternates(path);
  return routing.locales.map((l) => ({ url: absoluteUrl(l, path), alternates: { languages }, ...extra }));
}

/** 일부 언어판만 있는 페이지 */
function someLocales(path: string, locales: string[], extra: Partial<Entry> = {}): Entry[] {
  const languages = publishedLanguageAlternates(path, locales);
  return locales.map((l) => ({ url: absoluteUrl(l, path), alternates: { languages }, ...extra }));
}

async function pageEntries(): Promise<Entry[]> {
  // 데일리: 날짜 → 발행 언어
  const daily = new Map<string, string[]>();
  for (const l of routing.locales) {
    for (const e of await listPublishedEditions(l, 5000)) daily.set(e.edition_date, [...(daily.get(e.edition_date) ?? []), l]);
  }
  const dailyLocales = routing.locales.filter((l) => [...daily.values()].some((ls) => ls.includes(l)));

  const weekly = new Map<string, { locales: string[]; lastmod: string | null }>();
  for (const w of await listPublishedWeeklies()) {
    const cur = weekly.get(w.iso_week) ?? { locales: [], lastmod: w.published_at };
    cur.locales.push(w.locale);
    weekly.set(w.iso_week, cur);
  }
  const weeklyLocales = routing.locales.filter((l) => [...weekly.values()].some((w) => w.locales.includes(l)));

  return [
    ...allLocales("/", { changeFrequency: "hourly", priority: 1 }),
    ...allLocales("/statistics", { changeFrequency: "daily", priority: 0.3 }),
    // 신뢰 페이지(소개·만드는 방법·정정 기록·개인정보 처리방침, P0-6) — footer 와 같은 목록
    ...TRUST_PAGES.flatMap((p) => allLocales(p.path, { changeFrequency: p.key === "corrections" ? "weekly" : "monthly", priority: 0.3 })),
    // 브리핑 첫 화면·지난 판 목록은 발행본이 없으면 noindex 라 넣지 않는다
    ...(dailyLocales.length ? someLocales(BRIEFING_PATH, dailyLocales, { changeFrequency: "daily", priority: 0.8 }) : []),
    ...(dailyLocales.length ? someLocales(`${BRIEFING_PATH}/archive`, dailyLocales, { changeFrequency: "daily", priority: 0.4 }) : []),
    ...(weeklyLocales.length ? someLocales(WEEKLY_PATH, weeklyLocales, { changeFrequency: "weekly", priority: 0.6 }) : []),
    ...[...daily.entries()].flatMap(([date, locales]) =>
      someLocales(briefingDatePath(date), locales, { lastModified: date, changeFrequency: "monthly", priority: 0.7 })
    ),
    ...[...weekly.entries()].flatMap(([week, w]) =>
      someLocales(`${WEEKLY_PATH}/${week}`, w.locales, { ...(w.lastmod ? { lastModified: w.lastmod } : {}), changeFrequency: "monthly", priority: 0.6 })
    ),
  ];
}

async function articleEntries(chunk: number): Promise<Entry[]> {
  const rows = await listSitemapNews(chunk);
  return rows.flatMap((r) => allLocales(`/news/${r.id}`, r.lastmod ? { lastModified: r.lastmod } : {}));
}

export async function sitemapEntries(id: number): Promise<Entry[]> {
  if (!Number.isInteger(id) || id < 0) return [];
  return id === 0 ? pageEntries() : articleEntries(id - 1);
}
