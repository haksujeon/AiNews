"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { BRIEFING_PATH } from "@/lib/briefing/view";

/**
 * 마스트헤드: 워드마크(로케일별 "AI 뉴스") + 작은 부제. 아이콘 타일·두 색 로고·그라데이션 선 없음.
 * 관리자 링크는 공개 헤더에 두지 않는다(/admin 직접 접근).
 */
export function Header() {
  const t = useTranslations("common");

  return (
    <header className="sticky top-0 z-50 border-b border-rule bg-background">
      <div className="container mx-auto flex h-14 items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 items-center gap-5 sm:gap-8">
          <Link
            href="/"
            className="flex min-w-0 items-baseline gap-2.5 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <span className="whitespace-nowrap text-[19px] font-[760] tracking-[-0.02em] text-ink">
              {t("appName")}
            </span>
            <span className="hidden whitespace-nowrap text-[13px] text-ink-3 sm:inline">
              {t("brandTagline")}
            </span>
          </Link>
          <nav className="flex items-center gap-3 sm:gap-4">
            {/* 브리핑 진입점: 홈 띠와 같은 경로(BRIEFING_PATH = 최신 판) */}
            <Link
              href={BRIEFING_PATH}
              data-testid="nav-briefing"
              className="rounded-sm px-1 py-2 text-sm font-semibold text-ink transition-colors hover:text-jade focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("briefing")}
            </Link>
            <Link
              href="/statistics"
              className="rounded-sm px-1 py-2 text-sm text-ink-2 transition-colors hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("statistics")}
            </Link>
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <ThemeToggle />
          <LanguageSwitcher />
        </div>
      </div>
    </header>
  );
}
