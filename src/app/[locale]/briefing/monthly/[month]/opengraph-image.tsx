import { OG_CONTENT_TYPE, OG_SIZE } from "@/lib/seo/og-card";
import { renderPeriodicOg } from "@/lib/seo/periodic-og";

// monthly 리포트 공유 카드 — 데일리와 같은 카드 틀 (periodic-og.tsx)
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;
export const alt = "SDSC AI NEWS";

export default async function Image({ params }: { params: Promise<{ locale: string; month: string }> }) {
  const { locale, month } = await params;
  return renderPeriodicOg("monthly", locale, month);
}
