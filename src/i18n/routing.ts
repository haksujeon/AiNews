import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["ko", "en", "zh"],
  defaultLocale: "ko",
});

export type Locale = (typeof routing.locales)[number];
