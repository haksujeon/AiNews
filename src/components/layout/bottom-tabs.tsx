"use client";

import { useTranslations } from "next-intl";
import { Home, List, Newspaper, Search } from "lucide-react";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { BRIEFING_PATH } from "@/lib/briefing/view";

/**
 * 휴대폰 하단 탭 (2026-11-03 메뉴 개편, 768px 미만에서만): 홈 · 뉴스 · 브리핑 · 검색.
 * 상단 헤더의 주 메뉴와 같은 목적지 (Gate 2 — 메뉴 항목은 mainNavItems 하나).
 * 검색 = /news?focus=search (뉴스 목록 검색창에 커서). 관리자 화면에서는 그리지 않는다.
 * 고정 막대가 마지막 내용을 가리지 않도록 같은 높이의 빈 칸을 흐름에 둔다.
 */
export function mainNavItems() {
  return [
    { key: "home", href: "/", match: (p: string) => p === "/", Icon: Home },
    { key: "news", href: "/news", match: (p: string) => p === "/news" || p.startsWith("/news/"), Icon: List },
    { key: "briefing", href: BRIEFING_PATH, match: (p: string) => p.startsWith(BRIEFING_PATH), Icon: Newspaper },
  ] as const;
}

export function BottomTabs() {
  const t = useTranslations("common");
  const pathname = usePathname();
  if (pathname.startsWith("/admin")) return null;
  const items = [
    ...mainNavItems(),
    { key: "search", href: "/news?focus=search", match: () => false, Icon: Search },
  ];
  return (
    <>
      <div className="h-16 md:hidden" aria-hidden="true" />
      <nav
        aria-label={t("bottomNav")}
        data-testid="bottom-tabs"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-rule bg-background/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <ul className="grid h-16 grid-cols-4">
          {items.map(({ key, href, match, Icon }) => {
            const active = match(pathname);
            return (
              <li key={key}>
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-full flex-col items-center justify-center gap-1 text-[11px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    active ? "font-semibold text-ink" : "text-ink-2"
                  )}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" strokeWidth={active ? 2.25 : 1.75} />
                  {t(key)}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
