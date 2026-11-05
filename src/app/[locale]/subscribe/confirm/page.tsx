import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { isLocale } from "@/i18n/routing";
import { verifyConfirmToken } from "@/lib/newsletter/signup";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";
import { ConfirmButton } from "@/components/newsletter/confirm-button";

/**
 * 구독 확인 화면 (확인 메일의 버튼). 열기만 해서는 구독되지 않고 버튼을 눌러야 한다 —
 * 회사 메일 보안 검사기가 링크를 미리 열어 보기 때문 (수신 거부 화면과 같은 규칙). 색인하지 않는다.
 */
interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ t?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "subscribe" });
  return { title: t("confirmTitle"), robots: { index: false, follow: false } };
}

export default async function SubscribeConfirmPage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const { t: token } = await searchParams;
  const t = await getTranslations({ locale, namespace: "subscribe" });
  const valid = typeof token === "string" && verifyConfirmToken(token) !== null;
  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main id="main" className="container mx-auto flex-1 px-4">
        <section className="mx-auto grid max-w-[34rem] gap-4 py-12 sm:py-16" data-testid="subscribe-confirm-page">
          <h1 className="text-[26px] font-[760] leading-tight tracking-[-0.015em] text-ink">{t("confirmTitle")}</h1>
          {valid ? (
            <>
              <p className="text-[16px] leading-[1.75] text-ink-2">{t("confirmBody")}</p>
              <ConfirmButton token={token!} />
            </>
          ) : (
            <p className="text-[16px] leading-[1.75] text-ink-2" data-testid="subscribe-confirm-invalid">
              {t("confirmInvalid")}
            </p>
          )}
        </section>
      </main>
      <Footer />
    </div>
  );
}
