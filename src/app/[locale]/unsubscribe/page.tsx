import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { isLocale } from "@/i18n/routing";
import { verifyUnsubscribeToken } from "@/lib/newsletter/token";
import { UnsubscribeButton } from "@/components/newsletter/unsubscribe-button";
import { Header } from "@/components/layout/header";
import { Footer } from "@/components/layout/footer";

/**
 * 메일 수신 거부 화면 (메일 맺음의 링크). 열기만 해서는 아무것도 바뀌지 않고, 버튼을 눌러야 끊긴다 —
 * 메일 보안 검사기가 링크를 미리 열어 보기 때문. 색인하지 않는다.
 */
interface Props {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ t?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const t = await getTranslations({ locale, namespace: "unsubscribe" });
  return { title: t("title"), robots: { index: false, follow: false } };
}

export default async function UnsubscribePage({ params, searchParams }: Props) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const { t: token } = await searchParams;
  const t = await getTranslations({ locale, namespace: "unsubscribe" });
  const valid =
    typeof token === "string" && verifyUnsubscribeToken(token) !== null;

  return (
    <div className="flex min-h-screen flex-col">
      <Header />
      <main id="main" tabIndex={-1} className="scroll-mt-16 outline-none container mx-auto flex-1 px-4">
        <section
          className="mx-auto grid max-w-[36rem] gap-4 py-12 sm:py-16"
          data-testid="unsubscribe-page"
        >
          <h1 className="text-[26px] font-[760] leading-tight tracking-[-0.015em] text-ink">
            {t("title")}
          </h1>
          {valid ? (
            <>
              <p className="text-[16px] leading-[1.75] text-ink-2">
                {t("body")}
              </p>
              <UnsubscribeButton token={token!} />
            </>
          ) : (
            <p
              className="text-[16px] leading-[1.75] text-ink-2"
              data-testid="unsubscribe-invalid"
            >
              {t("invalid")}
            </p>
          )}
        </section>
      </main>
      <Footer />
    </div>
  );
}
