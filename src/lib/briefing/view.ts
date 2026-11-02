/**
 * 브리핑 화면용 순수 함수 (DB 없음). 공개 페이지·관리자 미리보기·메타데이터·JSON-LD 가 함께 쓴다.
 */
import { getSourceName } from "@/lib/news-utils";
import { absoluteUrl } from "@/lib/site";
import { LOCALE_HTML_LANG, type Locale } from "@/i18n/routing";
import type { BriefingArticleRef, PublicBriefing } from "./public";
import type { BriefingLocale, StoredBriefingContent } from "./types";

export const BRIEFING_PATH = "/briefing";
export const briefingDatePath = (date: string) => `${BRIEFING_PATH}/${date}`;

/** 인용 기사들의 서로 다른 매체(원어 표기) */
export function outletsOf(refs: string[], articles: Record<string, BriefingArticleRef>): string[] {
  const out: string[] = [];
  for (const r of refs) {
    const a = articles[r];
    if (!a) continue;
    const name = getSourceName(a.source_name);
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/** refs → 화면에 쓸 기사 목록 (보이는 것만). 같은 매체의 기사가 여럿이면 첫 기사 하나만 ("虎嗅·36氪·虎嗅" 방지) */
export function sourceLinks(refs: string[], articles: Record<string, BriefingArticleRef>) {
  const seen = new Set<string>();
  return refs
    .map((r) => articles[r])
    .filter((a): a is BriefingArticleRef => Boolean(a))
    .map((a) => ({ id: a.id, outlet: getSourceName(a.source_name), outletIsOriginal: getSourceName(a.source_name) !== a.source_name, title: a.title }))
    .filter((s) => (seen.has(s.outlet) ? false : (seen.add(s.outlet), true)));
}

/** "2026-10-13" → "10월 13일" / "Oct 13" / "10月13日" */
export function formatShortDate(date: string, locale: string): string {
  const [, m, d] = date.split("-").map(Number);
  if (locale === "ko") return `${m}월 ${d}일`;
  if (locale === "zh") return `${m}月${d}日`;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[m - 1]} ${d}`;
}

/** 본문 글자 수로 읽는 시간(분) */
export function readMinutes(c: StoredBriefingContent, locale: string): number {
  const text = [
    c.headline,
    c.lede,
    ...c.top_stories.flatMap((s) => [s.title, s.what, s.why]),
    ...c.sections.flatMap((s) => s.items.map((i) => i.text)),
  ].join("");
  const cpm = locale === "en" ? 1100 : 500;
  return Math.max(1, Math.round(text.length / cpm));
}

/**
 * 편집 노트: LLM 이 쓴 editor_note 가 없으면 결정적으로 만든다 —
 * 매체 수가 가장 많은 주요 기사 (2개 매체 이상일 때만).
 */
export function editorNoteData(b: PublicBriefing): { story: string; outlets: number } | null {
  let best: { story: string; outlets: number } | null = null;
  for (const s of b.content.top_stories) {
    const n = outletsOf(s.refs, b.articles).length;
    if (n >= 2 && (!best || n > best.outlets)) best = { story: s.title, outlets: n };
  }
  return best;
}

/** hreflang: 발행된 언어판만 + x-default (ko 가 있으면 ko, 없으면 첫 언어) */
export function briefingAlternates(date: string, locales: BriefingLocale[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of locales) out[LOCALE_HTML_LANG[l as Locale]] = absoluteUrl(l, briefingDatePath(date));
  if (locales.length) out["x-default"] = absoluteUrl(locales.includes("ko") ? "ko" : locales[0], briefingDatePath(date));
  return out;
}

/** JSON 을 <script> 안에 넣을 때 '<' 를 이스케이프 (LLM 텍스트가 </script> 를 담아도 안전) */
export function safeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(new RegExp(String.fromCharCode(0x2028), "g"), "\\u2028")
    .replace(new RegExp(String.fromCharCode(0x2029), "g"), "\\u2029");
}

/** NewsArticle(author Organization, isBasedOn 인용 기사) + 주요 기사 ItemList */
export function briefingJsonLd(b: PublicBriefing, opts: { brand: string; title: string }) {
  const url = absoluteUrl(b.locale, briefingDatePath(b.edition_date));
  const cited = Object.keys(b.articles).map((id) => absoluteUrl(b.locale, `/news/${id}`));
  const org = { "@type": "Organization", name: opts.brand, url: absoluteUrl(b.locale) };
  return [
    {
      "@context": "https://schema.org",
      "@type": "NewsArticle",
      headline: opts.title.slice(0, 110),
      description: b.content.lede,
      datePublished: b.published_at || `${b.edition_date}T00:00:00+08:00`,
      dateModified: b.published_at || `${b.edition_date}T00:00:00+08:00`,
      inLanguage: LOCALE_HTML_LANG[b.locale as Locale],
      mainEntityOfPage: url,
      url,
      author: org,
      publisher: org,
      isBasedOn: cited,
    },
    {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: b.content.headline,
      itemListOrder: "https://schema.org/ItemListOrderDescending",
      numberOfItems: b.content.top_stories.length,
      itemListElement: b.content.top_stories.map((s) => ({
        "@type": "ListItem",
        position: s.rank,
        name: s.title,
        url: `${url}#story-${s.rank}`,
      })),
    },
  ];
}
