"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Newspaper } from "lucide-react";
import { LanguageSwitcher } from "@/components/layout/language-switcher";

export function Header() {
  const t = useTranslations("common");

  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-16 items-center justify-between px-4">
        <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
          <Newspaper className="h-6 w-6 text-primary" />
          <span className="text-xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
            {t("appName")}
          </span>
        </Link>
        <LanguageSwitcher />
      </div>
    </header>
  );
}
