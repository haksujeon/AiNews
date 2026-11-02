import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { BRIEFING_PATH } from "@/lib/briefing/view";

/*
 * 브리핑 아래 판 종류 탭: 데일리 / 주간. (월간 탭은 v2 에서 월간 리포트를 낼 때 연다)
 * 높이 44px 이상, 현재 탭에 aria-current. 넘치면 탭 줄 안에서만 가로 스크롤.
 */
export const WEEKLY_PATH = `${BRIEFING_PATH}/weekly`;

export function BriefingTabs({ current }: { current: "daily" | "weekly" }) {
  const t = useTranslations("briefing");
  const tabs = [
    { key: "daily", href: BRIEFING_PATH, label: t("tabDaily") },
    { key: "weekly", href: WEEKLY_PATH, label: t("tabWeekly") },
  ] as const;
  return (
    <nav aria-label={t("tabsLabel")} className="mt-3.5 flex gap-1 overflow-x-auto border-b border-rule text-sm [scrollbar-width:none]" data-testid="briefing-tabs">
      {tabs.map((tab) => (
        <Link
          key={tab.key}
          href={tab.href}
          aria-current={current === tab.key ? "page" : undefined}
          className={cn(
            "-mb-px flex min-h-11 items-center whitespace-nowrap border-b-2 px-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            current === tab.key ? "border-ink font-bold text-ink" : "border-transparent text-ink-3 hover:text-ink"
          )}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
