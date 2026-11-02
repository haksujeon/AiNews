import type { Metadata } from "next";
import { BriefingPageContent, briefingMetadata } from "@/components/briefing/briefing-page";

// 날짜별 판. 형식이 틀렸거나 미래 날짜거나 발행된 판이 없으면 404 (다른 언어판만 있으면 안내 화면).
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ locale: string; date: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, date } = await params;
  return briefingMetadata(locale, date);
}

export default async function BriefingDatePage({ params }: Props) {
  const { locale, date } = await params;
  return <BriefingPageContent locale={locale} date={date} />;
}
