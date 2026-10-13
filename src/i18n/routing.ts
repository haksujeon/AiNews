import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["ko", "en", "zh"],
  defaultLocale: "ko",
});

export type Locale = (typeof routing.locales)[number];

/** <html lang> / hreflang 에 쓰는 BCP 47 태그. 라우트 세그먼트는 "zh" 지만 간체 중국어다. */
export const LOCALE_HTML_LANG: Record<Locale, string> = {
  ko: "ko",
  en: "en",
  zh: "zh-CN",
};

export function isLocale(value: string): value is Locale {
  return (routing.locales as readonly string[]).includes(value);
}
