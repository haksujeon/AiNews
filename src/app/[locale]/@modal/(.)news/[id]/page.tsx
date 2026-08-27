import { notFound } from "next/navigation";
import { fetchNewsById } from "@/lib/supabase";
import { RouteNewsModal } from "./route-modal";

interface Props {
  params: Promise<{ locale: string; id: string }>;
}

export default async function InterceptedNewsDetailPage({ params }: Props) {
  const { id } = await params;
  const news = await fetchNewsById(id);

  if (!news) {
    notFound();
  }

  return <RouteNewsModal news={news} />;
}
