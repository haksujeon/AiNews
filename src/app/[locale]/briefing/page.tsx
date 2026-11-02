import type { Metadata } from "next";
import { BriefingPageContent, briefingMetadata } from "@/components/briefing/briefing-page";

// 최신 발행판. canonical 은 날짜 URL(/briefing/YYYY-MM-DD). DB 를 읽으므로 빌드 때 미리 그리지 않는다.
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return briefingMetadata(locale);
}

export default async function BriefingLatestPage({ params }: Props) {
  const { locale } = await params;
  return <BriefingPageContent locale={locale} />;
}
