import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isLocale } from "@/i18n/routing";
import { LEGAL_VARS, TrustPage, trustMetadata } from "@/components/trust/trust-page";
import { Markdown } from "@/lib/trust/markdown";
import { loadLegal } from "@/lib/trust/content";

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
  const source = await loadLegal(locale, "about");
  return (
    <TrustPage locale={locale} pageKey="about" draft>
      <Markdown source={source} vars={LEGAL_VARS} />
    </TrustPage>
  );
}
