import type { Metadata } from "next";
import { readFile } from "node:fs/promises";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/routing";
import { isValidEditionDate } from "@/lib/briefing/generate";
import { getPublishedBriefing } from "@/lib/briefing/public";
import { cardSpecPath } from "@/lib/briefing/media-store";
import type { CardSpec } from "@/lib/briefing/card-spec";
import { BriefingCard } from "@/components/briefing/briefing-card";

// "한 장 요약" 카드를 그리는 화면 — scripts/briefing-card.ts 가 Playwright 로 찍어 PNG 를 만든다.
// 그림 명세(card-spec.json)가 있는 판만 열린다. 사람이 볼 화면이 아니므로 색인하지 않는다.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

interface Props {
  params: Promise<{ locale: string; date: string }>;
}

export default async function BriefingCardPage({ params }: Props) {
  const { locale, date } = await params;
  if (!isLocale(locale) || !isValidEditionDate(date)) notFound();
  const briefing = await getPublishedBriefing(locale, date);
  if (!briefing) notFound();
  const file = cardSpecPath(date, locale);
  const spec = file ? ((await readFile(file, "utf8").then(JSON.parse).catch(() => null)) as CardSpec | null) : null;
  if (!spec) notFound();
  return (
    <main className="min-h-screen bg-white">
      <BriefingCard briefing={briefing} spec={spec} />
    </main>
  );
}
