import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { isLocale } from "@/i18n/routing";
import { LEGAL_VARS, TrustPage, trustMetadata } from "@/components/trust/trust-page";
import { Markdown } from "@/lib/trust/markdown";
import { loadLegal } from "@/lib/trust/content";
import { CONSENT_VERSION, PRIVACY_EFFECTIVE_DATE } from "@/lib/trust/config";

interface Props {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  return isLocale(locale) ? trustMetadata(locale, "privacy") : {};
}

// 판 문자열은 CONSENT_VERSION 하나에서 온다 — 뉴스레터 동의 기록(P0-4)이 같은 값을 저장한다
export default async function PrivacyPage({ params }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const [source, t] = await Promise.all([loadLegal(locale, "privacy"), getTranslations({ locale, namespace: "trust" })]);
  return (
    <TrustPage
      locale={locale}
      pageKey="privacy"
      draft
      meta={
        <span data-testid="consent-version" data-version={CONSENT_VERSION}>
          {t("versionLine", { version: CONSENT_VERSION, date: PRIVACY_EFFECTIVE_DATE })}
        </span>
      }
    >
      <Markdown source={source} vars={LEGAL_VARS} />
    </TrustPage>
  );
}
