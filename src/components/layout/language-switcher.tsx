"use client";

import { useLocale } from "next-intl";
import { useRouter, usePathname } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { routing, type Locale } from "@/i18n/routing";
import { Globe } from "lucide-react";

const localeLabels: Record<Locale, string> = {
  ko: "한국어",
  en: "English",
  zh: "中文",
};

export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const handleChange = (newLocale: string) => {
    // Replace the locale segment in the pathname
    const segments = pathname.split("/");
    segments[1] = newLocale;
    router.push(segments.join("/"));
  };

  return (
    <Select value={locale} onValueChange={handleChange}>
      <SelectTrigger className="w-32 h-8">
        <Globe className="h-4 w-4 mr-1" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {routing.locales.map((loc) => (
          <SelectItem key={loc} value={loc}>
            {localeLabels[loc]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
