"use client";

import { useTranslations } from "next-intl";

export function Footer() {
  const t = useTranslations("common");

  return (
    <footer className="border-t border-border/50 mt-12">
      <div className="container mx-auto px-4 py-5 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{t("footerText")}</p>
        <div className="flex items-center gap-1 text-xs text-muted-foreground/60">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Live
        </div>
      </div>
    </footer>
  );
}
