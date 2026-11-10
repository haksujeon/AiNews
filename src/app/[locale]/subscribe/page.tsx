import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { isLocale } from "@/i18n/routing";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { SubscribeForm } from "@/components/newsletter/subscribe-form";
import { absoluteUrl, languageAlternates } from "@/lib/site";

/**
 * 아침 메일 구독 신청 (QR·사이트 "구독" 버튼). ?src= 는 어디서 왔는지(행사·자료별 QR) — 관리자 현황에 쓴다.
 * 휴대폰에서 QR 로 여는 화면이라 한 칸 폭, 큰 글자·누름 영역.
 */
interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ src?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "subscribe" });
  // canonical·hreflang: QR 주소(?src=...)마다 따로 색인되지 않게 쿼리 없는 주소로 모은다 (QA C-05)
  return {
    title: t("pageTitle"),
    description: t("lead"),
    alternates: { canonical: absoluteUrl(locale, "/subscribe"), languages: languageAlternates("/subscribe") },
  };
}

export default async function SubscribePage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const { src } = await searchParams;
  const t = await getTranslations({ locale, namespace: "subscribe" });
  const source = typeof src === "string" ? src.replace(/[^a-z0-9-_]/gi, "").slice(0, 40) || null : null;
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main id="main" tabIndex={-1} className="scroll-mt-16 outline-none container mx-auto flex-1 px-4">
        <section className="mx-auto grid max-w-[34rem] gap-6 py-10 sm:py-14" data-testid="subscribe-page">
          <div className="grid gap-3">
            <p className="text-[13px] font-[650] text-jade">{t("kicker")}</p>
            <h1 className="text-[26px] font-[780] leading-[1.3] tracking-[-0.02em] text-ink sm:text-[30px]">{t("title")}</h1>
            <p className="text-[16px] leading-[1.75] text-ink-2">{t("lead")}</p>
          </div>
          <SubscribeForm defaultLang={locale} source={source} />
        </section>
      </main>
      <Footer />
    </div>
  );
}
