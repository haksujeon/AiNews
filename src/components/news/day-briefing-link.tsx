"use client";

import { useTranslations } from "next-intl";
import type { NewsDay } from "@/lib/news-types";
import { formatShortDate } from "@/lib/briefing/view";
import { BriefingDateLink } from "@/components/briefing/briefing-date-link";
import { dayBriefingFocusKey, openDayBriefing } from "./day-briefing-dialog";

/** 날짜 묶음의 브리핑 표시 상태 (e2e·Gate 3 측정용으로 묶음에 data-briefing-state 로 단다) */
export function dayBriefingState(day: Pick<NewsDay, "briefing" | "briefingPending">): "link" | "pending" | "none" {
  return day.briefing ? "link" : day.briefingPending ? "pending" : "none";
}

/**
 * 날짜 제목 바로 뒤의 "그날 브리핑 →" / "주말 합본 브리핑 →" 링크, 또는 흐린 "브리핑 발행 예정".
 *  - 발행본(보는 언어판)이 있으면 링크. 주소는 실제 브리핑 페이지라 새 탭·복사는 전체 페이지, 보통 클릭은 팝업(?briefing=).
 *  - 판이 없고 마감 전(sla.ts isEditionPending)이면 "발행 예정" (링크 아님, 시각 문구 없음).
 *  - 마감이 지났는데 없거나 다른 언어판만 있으면 아무것도 표시하지 않는다.
 * 누를 수 있는 높이 44px (제목 줄 높이를 늘리지 않도록 데스크톱은 음수 여백).
 */
export function DayBriefingLink({ day, locale }: { day: Pick<NewsDay, "date" | "briefing" | "briefingPending">; locale: string }) {
  const t = useTranslations("list");
  const b = day.briefing;
  if (!b) {
    if (!day.briefingPending) return null;
    return (
      <span className="text-[13px] text-ink-3 max-sm:order-3 max-sm:flex max-sm:min-h-8 max-sm:basis-full max-sm:items-center" data-testid="day-briefing-pending">
        {t("dayBriefingPending")}
      </span>
    );
  }
  const end = b.weekend ? formatShortDate(new Date(Date.parse(`${b.editionDate}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10), locale) : "";
  const label = b.weekend
    ? t("dayBriefingWeekendAria", { range: `${formatShortDate(b.editionDate, locale)}~${end}`, headline: b.headline })
    : t("dayBriefingAria", { date: formatShortDate(b.editionDate, locale), headline: b.headline });

  return (
    <BriefingDateLink
      date={b.editionDate}
      aria-label={label}
      data-focus-key={dayBriefingFocusKey(day.date)}
      data-testid="day-briefing-link"
      data-edition={b.editionDate}
      data-analytics="day-briefing-open"
      onClick={(e) => {
        // 새 탭·창(수정 키, 가운데 버튼)은 브라우저 기본 동작 = 전체 브리핑 페이지
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        openDayBriefing(b.editionDate, day.date);
      }}
      className="group -my-3 inline-flex min-h-11 items-center rounded-sm text-[13px] font-[650] text-jade focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:order-3 max-sm:my-0 max-sm:basis-full"
    >
      <span className="group-hover:underline group-hover:decoration-1 group-hover:underline-offset-4">
        {b.weekend ? t("dayBriefingWeekend") : t("dayBriefing")}
      </span>
      <span aria-hidden="true" className="ml-1">
        →
      </span>
    </BriefingDateLink>
  );
}
