"use client";

import { useTranslations } from "next-intl";

export function Footer() {
  const t = useTranslations("common");

  return (
    <footer className="border-t mt-16">
      <div className="container mx-auto px-4 py-6 text-center text-sm text-muted-foreground">
        <p>{t("footerText")}</p>
      </div>
    </footer>
  );
}
