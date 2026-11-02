import { notFound } from "next/navigation";
import { fetchNewsById } from "@/lib/supabase";
import { toPublicNewsItem } from "@/lib/news-gist";
import { RouteNewsModal } from "./route-modal";

interface Props {
  params: Promise<{ locale: string; id: string }>;
}

export default async function InterceptedNewsDetailPage({ params }: Props) {
  const { locale, id } = await params;
  const news = await fetchNewsById(id);

  if (!news) {
    notFound();
  }

  // 상세 페이지와 같이 번역 전문은 빼고 요지만 넘긴다 (P0-7, 가로채기 RSC 페이로드)
  return <RouteNewsModal news={toPublicNewsItem(news, locale)} />;
}
