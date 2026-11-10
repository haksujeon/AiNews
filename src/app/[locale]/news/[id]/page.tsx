import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { fetchNewsById, fetchRelatedNews } from "@/lib/supabase";
import { getCategoryLabel, getSourceName, getSummary, getTitle } from "@/lib/news-utils";
import { toPublicNewsItem } from "@/lib/news-gist";
import { withNewsFx } from "@/lib/fx/news";
import { absoluteUrl, languageAlternates } from "@/lib/site";
import { LOCALE_HTML_LANG, isLocale } from "@/i18n/routing";
import { notFoundMetadata } from "@/lib/seo/not-found-meta";
import { clipText } from "@/lib/seo/text";
import { breadcrumbLd, newsArticleLd, ogImagePath, safeJsonLd } from "@/lib/seo/jsonld";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { NewsDetail } from "@/components/news/news-detail";

interface Props {
  params: Promise<{ locale: string; id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, id } = await params;
  const news = await fetchNewsById(id);
  if (!news || !isLocale(locale)) {
    return notFoundMetadata(locale);
  }

  const title = getTitle(news, locale);
  const description = clipText(getSummary(news, locale), 160);
  // 공유 이미지는 같은 폴더의 opengraph-image.tsx(자체 카드)가 채운다. 원문 og_image_url·썸네일·AI 커버는
  // 제3자 자산이라 공유 카드에 쓰지 않는다(결정 D3).
  const path = `/news/${news.id}`;

  return {
    title,
    description,
    // 숨긴 기사(AI 무관 등): 예전 뉴스레터 링크로는 열리게 두되 검색 색인에서는 뺀다.
    ...(news.is_hidden ? { robots: { index: false, follow: true } } : {}),
    alternates: {
      canonical: absoluteUrl(locale, path),
      languages: languageAlternates(path),
    },
    openGraph: {
      type: "article",
      title,
      description,
      url: absoluteUrl(locale, path),
      locale: LOCALE_HTML_LANG[locale].replace("-", "_"),
      publishedTime: news.news_date ?? undefined,
    },
    // twitter:image 가 없으면 X 는 og:image(자체 카드)를 쓴다
    twitter: {
      card: "summary_large_image",
      title,
      description,
    },
  };
}

export default async function NewsDetailPage({ params }: Props) {
  const { locale, id } = await params;
  const news = await fetchNewsById(id);

  if (!news) {
    notFound();
  }

  const relatedNews = await fetchRelatedNews(news.id);

  // 구조화 데이터: NewsArticle(번역 전문 articleBody 없음) + BreadcrumbList(홈 → 기사). 발행자는 레이아웃과 같은 organizationLd.
  const [tm, ts] = await Promise.all([getTranslations({ locale, namespace: "meta" }), getTranslations({ locale, namespace: "seo" })]);
  const path = `/news/${news.id}`;
  const title = getTitle(news, locale);
  const jsonLd = [
    newsArticleLd({
      locale,
      path,
      headline: title,
      description: getSummary(news, locale),
      image: absoluteUrl(locale, ogImagePath(path)),
      datePublished: news.news_date,
      dateModified: news.created_at && news.news_date && news.created_at > news.news_date ? news.created_at : news.news_date,
      brand: tm("brand"),
      section: news.category ? getCategoryLabel(news.category, locale) : null,
      source: { url: news.source_url, outlet: getSourceName(news.source_name) },
    }),
    breadcrumbLd([
      { name: ts("breadcrumbHome"), url: absoluteUrl(locale) },
      { name: clipText(title, 110), url: absoluteUrl(locale, path) },
    ]),
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main id="main" tabIndex={-1} className="scroll-mt-16 outline-none flex-1 container mx-auto px-4 py-8">
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }} />
        {/* 클라이언트 컴포넌트로는 번역 전문(content_*)을 넘기지 않는다 — RSC 페이로드에 실리지 않게 요지만 (P0-7) */}
        {/* 금액 환산 표기: 팝업·공개 상세 API 와 같은 withNewsFx (fx/news.ts) */}
        <NewsDetail news={await withNewsFx(toPublicNewsItem(news, locale), locale)} relatedNews={relatedNews} />
      </main>
      <Footer />
    </div>
  );
}
