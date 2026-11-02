"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { TRUST_PAGES } from "@/lib/trust/pages";

/** 수집 매체(원어 표기). 카드·상세의 getSourceName() 과 같은 이름을 쓴다. */
const SOURCES = ["虎嗅", "IT之家", "量子位", "36氪", "机器之心", "新智元"];

export function Footer() {
  const t = useTranslations("common");
  const tt = useTranslations("trust");

  return (
    <footer className="mt-16 border-t border-rule">
      <div className="container mx-auto flex flex-col gap-2 px-4 py-6 text-xs leading-relaxed text-ink-3 sm:flex-row sm:items-start sm:justify-between sm:gap-8">
        {/* AI 생성 고지 (AI 기본법) — 모든 페이지 공통 */}
        <p className="max-w-2xl">{t("footerText")}</p>
        <p className="shrink-0">
          {t("sourcesLabel")}: <span lang="zh-CN">{SOURCES.join(", ")}</span>
        </p>
      </div>
      {/* 신뢰 페이지 링크 묶음 (P0-6). 목록은 TRUST_PAGES 하나 — sitemap 도 같은 목록을 쓴다 */}
      <nav aria-label={tt("footerNavLabel")} className="container mx-auto px-4 pb-6" data-testid="footer-trust-nav">
        <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-2">
          {TRUST_PAGES.map((p) => (
            <li key={p.key}>
              <Link
                href={p.path}
                className="inline-block rounded-sm py-1.5 hover:text-ink hover:underline hover:decoration-1 hover:underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {tt(`${p.key}.nav`)}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </footer>
  );
}
