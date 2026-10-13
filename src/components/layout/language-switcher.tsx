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
import { usePathname, getPathname } from "@/i18n/navigation";
import { BASE_PATH } from "@/lib/api-path";
import { Globe } from "lucide-react";

const localeLabels: Record<Locale, string> = {
  ko: "한국어",
  en: "English",
  zh: "中文",
};

export function LanguageSwitcher() {
  const locale = useLocale();
  const t = useTranslations("common");
  // next-intl usePathname 은 로케일 접두사가 빠진 경로("/news/123")를 돌려준다.
  const pathname = usePathname();

  const handleChange = (newLocale: string) => {
    // 전체 페이지 이동으로 전환한다. 소프트 이동이면 기사 페이지에서 /zh/news/[id] 가
    // @modal 가로채기 라우트에 걸려 "영문 페이지 위에 중문 모달"이 뜨고 <html lang> 도 갱신되지 않는다.
    const target = getPathname({ href: pathname, locale: newLocale as Locale });
    window.location.assign(`${BASE_PATH}${target}${window.location.search}`);
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
