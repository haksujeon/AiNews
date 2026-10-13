"use client";

import { useLocale, useTranslations } from "next-intl";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { routing, type Locale } from "@/i18n/routing";
import { useRouter, usePathname } from "@/i18n/navigation";
import { Globe } from "lucide-react";

const localeLabels: Record<Locale, string> = {
  ko: "한국어",
  en: "English",
  zh: "中文",
};

export function LanguageSwitcher() {
  const locale = useLocale();
  const t = useTranslations("common");
  const router = useRouter();
  // next-intl usePathname 은 로케일 접두사가 빠진 경로("/news/123")를 돌려준다.
  const pathname = usePathname();

  const handleChange = (newLocale: string) => {
    router.push(pathname, { locale: newLocale as Locale });
  };

  return (
    <Select value={locale} onValueChange={handleChange}>
      <SelectTrigger
        className="h-8 w-9 sm:w-32 px-2 sm:px-3 overflow-hidden"
        aria-label={t("changeLanguage")}
      >
        <Globe className="h-4 w-4 shrink-0" aria-hidden="true" />
        <SelectValue className="hidden sm:block" />
      </SelectTrigger>
      <SelectContent>
        {routing.locales.map((loc) => (
          <SelectItem key={loc} value={loc} lang={loc === "zh" ? "zh-CN" : loc}>
            {localeLabels[loc]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
