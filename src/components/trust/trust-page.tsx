/**
 * 신뢰 페이지(소개·만드는 방법·정정 기록·개인정보 처리방침) 공용 틀 (서버 컴포넌트, P0-6).
 * 메타데이터(trustMetadata)·제목·초안 띠·BreadcrumbList JSON-LD 를 네 페이지가 같은 함수로 만든다 (Gate 2).
 */
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { absoluteUrl, languageAlternates } from "@/lib/site";
import { breadcrumbLd, safeJsonLd } from "@/lib/seo/jsonld";
import { trustPath, type TrustPageKey } from "@/lib/trust/pages";
import { CONTACT_EMAIL, MODEL_DISCLOSURE, showLegalDraft } from "@/lib/trust/config";

/** 본문 마크다운의 {{이름}} 치환값 */
export const LEGAL_VARS: Record<string, string> = { contactEmail: CONTACT_EMAIL, model: MODEL_DISCLOSURE };

export async function trustMetadata(locale: string, key: TrustPageKey): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: "trust" });
  const path = trustPath(key);
  return {
    title: t(`${key}.title`),
    description: t(`${key}.description`),
    alternates: { canonical: absoluteUrl(locale, path), languages: languageAlternates(path) },
  };
}

export async function TrustPage({
  locale,
  pageKey,
  draft = false,
  meta,
  lead,
  headingText,
  children,
}: {
  locale: string;
  pageKey: TrustPageKey;
  /** 법무·사용자 승인 전 본문 — SHOW_LEGAL_DRAFT=1 일 때 띠를 보인다 */
  draft?: boolean;
  /** 제목 아래 작은 줄 (판·시행일 등) */
  meta?: ReactNode;
  /** 본문 위 전체 폭 영역 (소개 = 랜딩, 2026-11-03). 있으면 그 안에 h1 이 있으므로 본문 제목은 h2 + headingText */
  lead?: ReactNode;
  headingText?: string;
  children: ReactNode;
}) {
  const [t, ts] = await Promise.all([
    getTranslations({ locale, namespace: "trust" }),
    getTranslations({ locale, namespace: "seo" }),
  ]);
  const title = t(`${pageKey}.title`);
  const ld = breadcrumbLd([
    { name: ts("breadcrumbHome"), url: absoluteUrl(locale) },
    { name: title, url: absoluteUrl(locale, trustPath(pageKey)) },
  ]);

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      {lead}
      <main id="main" className="container mx-auto flex-1 px-4 pb-16" data-testid={`trust-${pageKey}`}>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(ld) }} />
        <div className="max-w-3xl border-b-2 border-rule-strong pb-3 pt-8">
          {lead ? (
            <h2 className="text-2xl font-[740] tracking-[-0.02em] text-ink sm:text-3xl">{headingText ?? title}</h2>
          ) : (
            <h1 className="text-2xl font-[740] tracking-[-0.02em] text-ink sm:text-3xl">{title}</h1>
          )}
          {meta && <p className="mt-1.5 text-[13px] text-ink-3">{meta}</p>}
        </div>
        {draft && showLegalDraft() && (
          <p role="note" data-testid="legal-draft" className="mt-4 max-w-3xl border-l-2 border-jade bg-jade-weak px-3 py-2 text-[13px] leading-relaxed text-ink-2">
            {t("draftBanner")}
          </p>
        )}
        <div className="pt-6">{children}</div>
      </main>
      <Footer />
    </div>
  );
}
