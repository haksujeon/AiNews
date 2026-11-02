import type { Metadata } from "next";
import { PeriodicPageContent, periodicMetadata } from "@/components/briefing/periodic-page";

// 최신 발행 월간 리포트 (주간과 같은 렌더러). canonical 은 월 URL(/briefing/monthly/2026-10).
export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return periodicMetadata("monthly", locale);
}

export default async function MonthlyLatestPage({ params }: Props) {
  const { locale } = await params;
  return <PeriodicPageContent kind="monthly" locale={locale} />;
}
