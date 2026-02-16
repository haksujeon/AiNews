import { notFound } from "next/navigation";
import { fetchNewsById } from "@/lib/supabase";
import { NewsDetailModal } from "@/components/news/news-detail-modal";

interface Props {
  params: Promise<{ locale: string; id: string }>;
}

export default async function InterceptedNewsDetailPage({ params }: Props) {
  const { id } = await params;
  const news = await fetchNewsById(id);

  if (!news) {
    notFound();
  }

  return <NewsDetailModal news={news} />;
}
