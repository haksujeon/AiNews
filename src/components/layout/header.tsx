"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { mainNavItems } from "@/components/layout/bottom-tabs";
import { LanguageSwitcher } from "@/components/layout/language-switcher";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { SubscribeLink } from "@/components/newsletter/subscribe-link";

/**
 * 마스트헤드: 워드마크(로케일별 "SDSC AI 뉴스") + 작은 부제. 아이콘 타일·두 색 로고·그라데이션 선 없음.
 * 관리자 링크는 공개 헤더에 두지 않는다(/admin 직접 접근).
 */
export function Header() {
  const t = useTranslations("common");
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-rule bg-background">
      {/* 키보드 사용자를 위한 본문 바로가기 — 탭 첫 번째, 포커스될 때만 보인다 (QA C-12·E-10). 대상은 각 페이지 <main id="main"> */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-2 focus:z-[60] focus:rounded-sm focus:bg-ink focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-background"
      >
        {t("skipToContent")}
      </a>
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
          {/* 주 메뉴 (2026-11-03 개편): 하단 탭(휴대폰)과 같은 목록 mainNavItems. 휴대폰에서는 하단 탭이 대신한다 */}
          <nav aria-label={t("mainNav")} className="hidden items-center gap-1 md:flex">
            {mainNavItems().map(({ key, href, match }) => {
              const active = match(pathname);
              return (
                <Link
                  key={key}
                  href={href}
                  data-testid={`nav-${key}`}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "rounded-sm px-2.5 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active ? "font-semibold text-ink" : "text-ink-2 hover:text-ink"
                  )}
                >
                  {t(key)}
                </Link>
              );
            })}
          </nav>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {/* 구독 신청 (2026-11-05). 신청 화면에서는 숨긴다 */}
          {!pathname.startsWith("/subscribe") && <SubscribeLink source="header" variant="nav" />}
          <ThemeToggle />
          <LanguageSwitcher />
        </div>
      </div>
    </header>
  );
}
