import type { Metadata } from "next";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { routing, LOCALE_HTML_LANG } from "@/i18n/routing";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { fontVariables, PRETENDARD_CSS_HREF } from "@/lib/fonts";
import { rootUrl } from "@/lib/site";
import { feedUrl } from "@/lib/feed";
import { safeJsonLd, siteJsonLd } from "@/lib/seo/jsonld";
import "../globals.css";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) return {};
  const t = await getTranslations({ locale, namespace: "meta" });
  return {
    // basePath 까지 넣는다: 파일 규칙 메타데이터(opengraph-image)의 URL 은 metadataBase 경로에 이어 붙는데
    // basePath 를 붙여 주지 않는다(없으면 og:image 가 /ainews 없는 404 주소가 된다). 다른 메타 URL 은 모두 absoluteUrl 로 절대 주소다.
    metadataBase: new URL(rootUrl("/")),
    title: {
      default: t("siteTitle"),
      template: `%s | ${t("brand")}`,
    },
    description: t("siteDescription"),
    openGraph: {
      siteName: t("brand"),
      type: "website",
      locale: LOCALE_HTML_LANG[locale].replace("-", "_"),
    },
  };
}

export default async function LocaleLayout({
  children,
  modal,
  params,
}: {
  children: React.ReactNode;
  modal: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  const messages = await getMessages();
  const [tm, ts] = await Promise.all([getTranslations({ locale, namespace: "meta" }), getTranslations({ locale, namespace: "seo" })]);
  const siteLd = siteJsonLd(locale, { brand: tm("brand"), description: tm("siteDescription") });

  return (
    // 테마 클래스(dark)는 next-themes 가 OS 설정/저장값으로 정한다. 강제 dark 없음.
    // 폰트 변수는 Tailwind preflight 가 html 에서 font-family 를 계산하므로 html 에 둔다.
    <html lang={LOCALE_HTML_LANG[locale]} className={fontVariables} suppressHydrationWarning>
      <head>
        {/* Pretendard dynamic-subset: @font-face 선언만 받고, 글자 조각은 쓰일 때만 받는다(미리 받기 없음).
            zh 는 Noto Sans SC 를 쓰므로 걸지 않는다. 언어 전환은 전체 페이지 이동이라 로케일별로 갈린다. */}
        {locale !== "zh" && <link rel="stylesheet" href={PRETENDARD_CSS_HREF} />}
        {/* RSS 자동 발견. metadata.alternates.types 는 페이지마다 alternates(canonical·hreflang)를 다시 정의하면
            통째로 덮여 사라지므로(메타데이터는 최상위 키 단위 병합) 여기서 직접 건다. */}
        <link rel="alternate" type="application/rss+xml" title={ts("rssLinkTitle")} href={feedUrl(locale, { kind: "all" })} />
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(siteLd) }} />
      </head>
      <body className="antialiased">
        <ThemeProvider>
          <NextIntlClientProvider messages={messages}>
            {children}
            {modal}
          </NextIntlClientProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
