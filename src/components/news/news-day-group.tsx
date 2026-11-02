"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, ChevronDown, ChevronUp, Loader2, RotateCw } from "lucide-react";
import type { NewsDay, RankedNewsItem } from "@/lib/news-types";
import type { NewsFilters } from "@/lib/news-query";
import { fetchNewsDayRestClient, isAbortError } from "@/lib/supabase-client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { NewsCard } from "./news-card";
import { NewsListItem } from "./news-list-item";

/** 그리드 보기의 칸 배치. 주요 4건과 펼친 나머지가 같은 칸 규칙을 써서 펼쳐도 기존 카드가 움직이지 않는다. */
const GRID_CLASS = "grid grid-cols-1 gap-x-8 gap-y-8 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

interface NewsDayGroupProps {
  day: NewsDay;
  /** 날짜 제목 (예: "2026년 11월 1일 (일)") */
  heading: string;
  viewMode: "grid" | "list";
  /** 목록과 같은 필터 — 펼친 나머지도 같은 조건 안에서 순위를 매긴다 */
  filters: NewsFilters;
  locale: string;
}

type PendingFocus = "first-new" | "toggle" | null;

/**
 * 날짜 하나: 제목 줄 + 주요 기사(공용 순위 상위 4건) + "이날 기사 N건 더 보기" 펼치기.
 * 그리드·리스트 보기가 같은 컴포넌트·같은 펼치기 로직을 쓴다 (Gate 2). 보기를 바꿔도 펼침 상태는 유지된다.
 *
 *  - 처음 펼칠 때만 서버에서 나머지를 받고, 접었다 다시 펼치면 받은 것을 그대로 쓴다.
 *  - 펼친 뒤 포커스는 새로 보인 첫 기사로, 접은 뒤에는 버튼으로 돌아온다.
 *  - 접을 때 버튼이 화면에서 같은 높이에 남도록 스크롤을 보정한다 (위쪽 내용이 사라져 화면이 튀지 않게).
 */
export function NewsDayGroup({ day, heading, viewMode, filters, locale }: NewsDayGroupProps) {
  const t = useTranslations("list");
  const tc = useTranslations("common");
  const [rest, setRest] = useState<RankedNewsItem[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const restRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pendingFocus = useRef<PendingFocus>(null);
  const toggleTopBeforeCollapse = useRef<number | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  // 펼침/접힘이 DOM 에 반영된 직후(그리기 전)에 포커스·스크롤을 맞춘다.
  useLayoutEffect(() => {
    const target = pendingFocus.current;
    pendingFocus.current = null;
    if (target === "first-new" && expanded) {
      restRef.current?.querySelector<HTMLElement>("a[href]")?.focus();
    } else if (target === "toggle" && !expanded) {
      const btn = toggleRef.current;
      const before = toggleTopBeforeCollapse.current;
      toggleTopBeforeCollapse.current = null;
      if (btn && before !== null) {
        const delta = btn.getBoundingClientRect().top - before;
        if (delta !== 0) window.scrollBy({ top: delta, behavior: "instant" as ScrollBehavior });
      }
      btn?.focus({ preventScroll: true });
    }
  }, [expanded]);

  const shownIds = day.top.map((i) => i.id);
  const restCount = rest ? rest.length : Math.max(day.total - day.top.length, 0);
  const hasMore = restCount > 0;
  const restId = `day-rest-${day.date}`;
  const headingId = `date-${day.date}`;

  const loadRest = async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoading(true);
    setError(false);
    try {
      const res = await fetchNewsDayRestClient(day.date, shownIds, filters, locale, controller.signal);
      if (controller.signal.aborted) return;
      setRest(res.items);
      pendingFocus.current = "first-new";
      setExpanded(true);
    } catch (e) {
      if (isAbortError(e)) return;
      console.warn("[news] day expand failed", e);
      setError(true);
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setLoading(false);
      }
    }
  };

  const onToggle = () => {
    if (loading) return;
    if (expanded) {
      toggleTopBeforeCollapse.current = toggleRef.current?.getBoundingClientRect().top ?? null;
      pendingFocus.current = "toggle";
      setExpanded(false);
      return;
    }
    if (rest) {
      pendingFocus.current = "first-new";
      setExpanded(true);
      return;
    }
    void loadRest();
  };

  const renderItems = (items: RankedNewsItem[]) =>
    items.map((item) =>
      viewMode === "grid" ? (
        <NewsCard key={item.id} item={item} outletCount={item.outlet_count} />
      ) : (
        <NewsListItem key={item.id} item={item} outletCount={item.outlet_count} />
      )
    );

  return (
    <section aria-labelledby={headingId} data-testid="news-day" data-date={day.date} data-total={day.total}>
      <div className="mb-2 flex items-baseline justify-between gap-4 border-b-2 border-rule-strong pb-2">
        <h3 id={headingId} className="text-[15px] font-bold text-ink">
          {heading}
        </h3>
        <span className="shrink-0 text-xs text-ink-3" data-testid="news-day-count">
          {day.total > day.top.length
            ? t("dayTopTotal", { top: day.top.length, total: day.total })
            : t("groupCount", { count: day.total })}
        </span>
      </div>

      <div data-testid="news-day-top" className={cn(viewMode === "grid" && cn(GRID_CLASS, "pt-2"))}>
        {renderItems(day.top)}
      </div>

      {hasMore && (
        <>
          {/* aria-controls 대상은 항상 DOM 에 둔다(접힌 동안 hidden). */}
          <div
            id={restId}
            ref={restRef}
            hidden={!expanded}
            data-testid="news-day-rest"
            className={cn(viewMode === "grid" && cn(GRID_CLASS, "mt-8"))}
          >
            {rest && renderItems(rest)}
          </div>

          {error && (
            <div
              role="alert"
              className="mt-4 flex flex-col items-center justify-center gap-3 text-sm text-ink-2 sm:flex-row"
              data-testid="news-day-error"
            >
              <span className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-destructive" aria-hidden="true" />
                {t("expandError")}
              </span>
              <Button variant="outline" size="sm" onClick={() => void loadRest()}>
                <RotateCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                {tc("retry")}
              </Button>
            </div>
          )}

          <button
            ref={toggleRef}
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            aria-controls={restId}
            aria-busy={loading || undefined}
            aria-describedby={headingId}
            data-testid="news-day-toggle"
            className={cn(
              "mt-6 flex min-h-11 w-full items-center justify-center gap-1.5 border-t border-rule pt-1 text-sm font-semibold text-ink",
              "hover:text-jade focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              loading && "cursor-progress text-ink-2"
            )}
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                {t("expandLoading")}
              </>
            ) : expanded ? (
              <>
                {t("collapseDay")}
                <ChevronUp className="h-4 w-4" aria-hidden="true" />
              </>
            ) : (
              <>
                {t("expandDay", { count: restCount })}
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              </>
            )}
          </button>
        </>
      )}
    </section>
  );
}
