"use client";

import { useTranslations } from "next-intl";

/** 수집 매체(원어 표기). 카드·상세의 getSourceName() 과 같은 이름을 쓴다. */
const SOURCES = ["虎嗅", "IT之家", "量子位", "36氪", "机器之心", "新智元"];

export function Footer() {
  const t = useTranslations("common");

  return (
    <footer className="mt-16 border-t border-rule">
      <div className="container mx-auto flex flex-col gap-2 px-4 py-6 text-xs leading-relaxed text-ink-3 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
        <p className="max-w-2xl">{t("footerText")}</p>
        <p className="shrink-0">
          {t("sourcesLabel")}: <span lang="zh-CN">{SOURCES.join(", ")}</span>
        </p>
      </div>
    </footer>
  );
}
