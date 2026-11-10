import { notFound } from "next/navigation";
import { notFoundMetadata } from "@/lib/seo/not-found-meta";

// 로케일 아래의 알 수 없는 경로를 [locale]/not-found.tsx(헤더 포함)로 보낸다.
// 제목은 다른 404 와 같은 "페이지를 찾을 수 없습니다 | 사이트" (QA C-02: 사이트 기본 제목이 나왔다).
export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  return notFoundMetadata(locale);
}

export default function CatchAllNotFound() {
  notFound();
}
