import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { fetchNewsById, fetchRelatedNews } from "@/lib/supabase";
import { getTitle, getSummary } from "@/lib/news-utils";
import { absoluteUrl, languageAlternates } from "@/lib/site";
import { LOCALE_HTML_LANG, isLocale } from "@/i18n/routing";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { NewsDetail } from "@/components/news/news-detail";

interface Props {
  params: Promise<{ locale: string; id: string }>;
}

function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, id } = await params;
  const news = await fetchNewsById(id);
  if (!news || !isLocale(locale)) {
    const t = await getTranslations({ locale: isLocale(locale) ? locale : "ko", namespace: "notFound" });
    return { title: t("title"), robots: { index: false } };
  }

  const title = getTitle(news, locale);
  const description = truncate(getSummary(news, locale), 160);
  const image = news.og_image_url || news.thumbnail_url;
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
      images: image ? [{ url: image }] : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title,
      description,
      images: image ? [image] : undefined,
    },
  };
}

export default async function NewsDetailPage({ params }: Props) {
  const { id } = await params;
  const news = await fetchNewsById(id);

  if (!news) {
    notFound();
  }

  const relatedNews = await fetchRelatedNews(news.id, news.country, news.category);

  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-1 container mx-auto px-4 py-8">
        <NewsDetail news={news} relatedNews={relatedNews} />
      </main>
      <Footer />
    </div>
  );
}
