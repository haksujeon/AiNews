/**
 * 브리핑 화면용 순수 함수 (DB 없음). 공개 페이지·관리자 미리보기·메타데이터·JSON-LD 가 함께 쓴다.
 */
import { getSourceName } from "@/lib/news-utils";
import { absoluteUrl, publishedLanguageAlternates } from "@/lib/site";
import { ogImagePath, organizationLd, safeJsonLd } from "@/lib/seo/jsonld";
import { LOCALE_HTML_LANG, type Locale } from "@/i18n/routing";
import type { BriefingArticleRef, PublicBriefing } from "./public";
import type { BriefingLocale, StoredBriefingContent } from "./types";
import { findEntities } from "./entities";

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
  return publishedLanguageAlternates(briefingDatePath(date), locales);
}

/** JSON-LD 이스케이프는 src/lib/seo/jsonld.ts 로 옮겼다. 기존 import 경로를 위해 다시 내보낸다 */
export { safeJsonLd };

/** NewsArticle(author Organization, isBasedOn 인용 기사) + 주요 기사 ItemList */
export function briefingJsonLd(b: PublicBriefing, opts: { brand: string; title: string }) {
  const url = absoluteUrl(b.locale, briefingDatePath(b.edition_date));
  const cited = Object.keys(b.articles).map((id) => absoluteUrl(b.locale, `/news/${id}`));
  // 발행자는 레이아웃·기사 상세와 같은 organizationLd (Gate 2)
  const org = organizationLd(b.locale, opts.brand);
  return [
    {
      "@context": "https://schema.org",
      "@type": "NewsArticle",
      headline: opts.title.slice(0, 110),
      description: b.content.lede,
      image: [absoluteUrl(b.locale, ogImagePath(briefingDatePath(b.edition_date)))],
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

/**
 * "주목할 기업" 중 주요 기사에 없는 정보만 (사용자 결정 2026-11-05, 안 A).
 * 같은 회사가 주요 기사에 나오고(별칭 포함 — entities.ts) 근거 기사도 모두 주요 기사의 것이면 겹치는 정보라 뺀다.
 * 최근 12판 실측: 21건 중 18건이 겹침. 남는 것은 주요 기사에 없는 회사이거나 다른 근거로 새 소식을 더하는 경우.
 */
export function extraCompanies(c: Pick<StoredBriefingContent, "companies_to_watch" | "top_stories">) {
  const topText = c.top_stories.map((s) => [s.title, s.what, s.why ?? "", s.subject ?? ""].join(" ")).join("\n");
  const topRefs = new Set(c.top_stories.flatMap((s) => s.refs));
  const inTop = new Set(findEntities(topText).map((e) => e.key));
  return c.companies_to_watch.filter((co) => {
    const ents = findEntities(co.name);
    const named = ents.length ? ents.some((e) => inTop.has(e.key)) : topText.includes(co.name);
    const sameSource = co.refs.length > 0 && co.refs.every((r) => topRefs.has(r));
    return !(named && sameSource);
  });
}
