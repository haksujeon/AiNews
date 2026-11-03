import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/routing";
import { LEGAL_VARS, TrustPage, trustMetadata } from "@/components/trust/trust-page";
import { Markdown } from "@/lib/trust/markdown";
import { loadLegal } from "@/lib/trust/content";
import { getTranslations } from "next-intl/server";
import { getPublishedBriefing } from "@/lib/briefing/public";
import { fetchPublicTotal } from "@/lib/today";
import { Landing } from "@/components/landing/landing";

interface Props {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return isLocale(locale) ? trustMetadata(locale, "about") : {};
}

export default async function AboutPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  // 2026-11-03: 소개 = 랜딩(어디서 어떻게 모아 브리핑을 만드는지) + 아래 기존 소개 본문("자세한 안내")
  const [source, t, briefing, total] = await Promise.all([
    loadLegal(locale, "about"),
    getTranslations({ locale, namespace: "landing" }),
    getPublishedBriefing(locale).catch(() => null),
    fetchPublicTotal().catch(() => 0),
  ]);
  return (
    <TrustPage locale={locale} pageKey="about" draft lead={<Landing locale={locale} briefing={briefing} total={total} />} headingText={t("moreTitle")}>
      <Markdown source={source} vars={LEGAL_VARS} />
    </TrustPage>
  );
}
