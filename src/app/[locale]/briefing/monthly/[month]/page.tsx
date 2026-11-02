import type { Metadata } from "next";
import { PeriodicPageContent, periodicMetadata } from "@/components/briefing/periodic-page";

// 월별 리포트 (예: 2026-10). 형식이 틀렸거나 끝나지 않은 달이거나 발행본이 없으면 404 (다른 언어판만 있으면 안내 화면).
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ locale: string; month: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, month } = await params;
  return periodicMetadata("monthly", locale, month);
}

export default async function MonthlyMonthPage({ params }: Props) {
  const { locale, month } = await params;
  return <PeriodicPageContent kind="monthly" locale={locale} periodKey={month} />;
}
