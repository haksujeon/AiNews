import type { Metadata } from "next";
import { WeeklyPageContent, weeklyMetadata } from "@/components/briefing/weekly-page";

// 최신 발행 주간 리포트. canonical 은 주 URL(/briefing/weekly/2026-W44). DB 를 읽으므로 빌드 때 미리 그리지 않는다.
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return weeklyMetadata(locale);
}

export default async function WeeklyLatestPage({ params }: Props) {
  const { locale } = await params;
  return <WeeklyPageContent locale={locale} />;
}
