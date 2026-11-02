import type { Metadata } from "next";
import { PeriodicPageContent, periodicMetadata } from "@/components/briefing/periodic-page";

// 주별 리포트 (ISO 주, 예: 2026-W44). 형식이 틀렸거나 끝나지 않은 주거나 발행본이 없으면 404 (다른 언어판만 있으면 안내 화면).
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ locale: string; week: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, week } = await params;
  return periodicMetadata("weekly", locale, week);
}

export default async function WeeklyWeekPage({ params }: Props) {
  const { locale, week } = await params;
  return <PeriodicPageContent kind="weekly" locale={locale} periodKey={week} />;
}
