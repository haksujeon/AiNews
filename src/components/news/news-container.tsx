"use client";

import { Suspense, useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Search, Loader2, AlertTriangle, RotateCw } from "lucide-react";
import type { NewsDay, NewsDaysPage } from "@/lib/news-types";
import { NEWS_DAYS_PER_PAGE } from "@/lib/news-types";
import { fetchNewsDaysClient, isAbortError } from "@/lib/supabase-client";
import { formatDateGroup } from "@/lib/news-utils";
import type { DateRange } from "@/lib/news-utils";
import type { NewsFilters } from "@/lib/news-query";
import type { RegionChip } from "@/lib/region";
import type { RegionCounts } from "@/lib/metrics/period";
import { useDebounce } from "@/hooks/use-debounce";
import { Button } from "@/components/ui/button";
import { NewsFilter } from "./news-filter";
import { NewsContainerSkeleton } from "./news-skeleton";
import { NewsDayGroup } from "./news-day-group";
import { DayBriefingDialog } from "./day-briefing-dialog";

interface NewsContainerProps {
  /** 서버가 렌더한 첫 페이지 (최근 NEWS_DAYS_PER_PAGE 일, 날마다 주요 4건) */
  initialPage: NewsDaysPage;
  /** 테이블 전체 기준 필터 선택지 */
  facets?: { countries: string[]; categories: string[]; regions?: RegionCounts };
  /** 주소의 ?region= (서버가 이 칩으로 첫 페이지를 걸러 보냈다) */
  initialRegion?: RegionChip;
  /** 주소의 ?q= (헤더·하단 탭 검색 → /news?q=, 서버가 이 검색어로 첫 페이지를 걸러 보냈다) */
  initialQuery?: string;
  /** 주소의 ?focus=search (휴대폰 하단 "검색" 탭) — 검색창에 바로 커서 */
  autoFocusSearch?: boolean;
  isLoading?: boolean;
}

// 목록은 날짜(베이징 news_date) 단위로 받는다. 날마다 공용 순위(src/lib/news-rank.ts)의 주요 4건만 먼저 보이고,
// "이날 기사 N건 더 보기"로 그날 전체를 펼친다 (NewsDayGroup). 무한 스크롤 한 번 = 다음 NEWS_DAYS_PER_PAGE 일.
// 검색·필터가 있으면 걸러진 기사 안에서 같은 방식(날짜 묶음 + 주요 4건 + 펼치기)으로 보인다.
//
// 기사 상세는 카드/리스트 항목의 링크(/news/[id])로 연다.
// 소프트 이동이면 @modal/(.)news/[id] 가 모달로 가로채고, 직접 접속이면 전체 페이지가 뜬다.
// 날짜 옆 "그날 브리핑" 은 ?briefing=YYYY-MM-DD 대화상자(DayBriefingDialog)로 연다 — 첫 화면과 무한 스크롤로 받은 날 모두 같은 링크.
export function NewsContainer({ initialPage, facets, initialRegion = "ALL", initialQuery = "", autoFocusSearch = false, isLoading = false }: NewsContainerProps) {
  const locale = useLocale();
  const t = useTranslations("list");
  const tc = useTranslations("common");
  const [days, setDays] = useState<NewsDay[]>(initialPage.days);
  const [total, setTotal] = useState(initialPage.total);
  const [nextCursor, setNextCursor] = useState<string | null>(initialPage.nextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filtering, setFiltering] = useState(false);
  // 첫 페이지(필터 변경) 실패 / 추가 로드 실패를 따로 관리한다.
  // moreError 가 있으면 무한 스크롤을 멈춰 재시도 루프를 막는다.
  const [listError, setListError] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [searchQuery, setSearchQuery] = useState(initialQuery);
  const [selectedCountry, setSelectedCountry] = useState("ALL");
  const [selectedRegion, setSelectedRegion] = useState<RegionChip>(initialRegion);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<DateRange>({});
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const sentinelRef = useRef<HTMLDivElement>(null);
  // 필터가 바뀔 때마다 증가. 이전 세대의 응답(추가 로드 포함)은 버린다.
  const generationRef = useRef(0);
  const loadMoreAbortRef = useRef<AbortController | null>(null);
  const hasMore = nextCursor !== null;

  // 검색어는 타이핑마다 요청하지 않도록 디바운스한다.
  const debouncedQuery = useDebounce(searchQuery, 350);

  const filters: NewsFilters = useMemo(
    () => ({
      q: debouncedQuery,
      country: selectedCountry,
      region: selectedRegion,
      categories: selectedCategories,
      from: dateRange.from ?? "",
      to: dateRange.to ?? "",
    }),
    [debouncedQuery, selectedCountry, selectedRegion, selectedCategories, dateRange.from, dateRange.to]
  );

  // 필터가 바뀌면 서버에서 첫 페이지를 다시 받아온다.
  // 초기 렌더(필터 없음 + 주소의 지역 칩·검색어)는 서버 컴포넌트가 이미 준 데이터를 쓰므로 건너뛴다.
  const isInitialFilters =
    filters.q === initialQuery &&
    filters.country === "ALL" &&
    filters.region === initialRegion &&
    filters.categories.length === 0 &&
    !filters.from &&
    !filters.to;
  const skipFirstFetch = useRef(true);

  useEffect(() => {
    if (skipFirstFetch.current && isInitialFilters && reloadToken === 0) {
      skipFirstFetch.current = false;
      return;
    }
    skipFirstFetch.current = false;

    const generation = ++generationRef.current;
    // 진행 중인 추가 로드는 이전 필터 기준이므로 중단한다.
    loadMoreAbortRef.current?.abort();
    const controller = new AbortController();

    setFiltering(true);
    setListError(false);
    setMoreError(false);
    fetchNewsDaysClient(null, filters, locale, controller.signal)
      .then((page) => {
        if (generation !== generationRef.current) return;
        setDays(page.days);
        setTotal(page.total);
        setNextCursor(page.nextCursor);
      })
      .catch((e) => {
        if (isAbortError(e) || generation !== generationRef.current) return;
        console.warn("[news] list fetch failed", e);
        setListError(true);
        setNextCursor(null);
      })
      .finally(() => {
        if (generation === generationRef.current) setFiltering(false);
      });
    return () => {
      controller.abort();
    };
  }, [filters, isInitialFilters, reloadToken, locale]);

  // Sync if initialPage changes (e.g. revalidation)
  useEffect(() => {
    setDays(initialPage.days);
    setTotal(initialPage.total);
    setNextCursor(initialPage.nextCursor);
  }, [initialPage]);

  const loadMore = useCallback(async () => {
    if (loadingMore || filtering || !nextCursor || moreError || listError) return;
    const generation = generationRef.current;
    const controller = new AbortController();
    loadMoreAbortRef.current = controller;
    setLoadingMore(true);
    try {
      // 현재 필터를 유지한 채 커서(마지막 날짜) 이전의 날들을 받는다.
      const page = await fetchNewsDaysClient(nextCursor, filters, locale, controller.signal);
      // 그 사이 필터가 바뀌었으면 이 결과는 다른 목록의 것이므로 버린다.
      if (generation !== generationRef.current) return;
      setTotal(page.total);
      setDays((prev) => {
        const seen = new Set(prev.map((d) => d.date));
        return [...prev, ...page.days.filter((d) => !seen.has(d.date))];
      });
      setNextCursor(page.days.length ? page.nextCursor : null);
    } catch (e) {
      if (isAbortError(e) || generation !== generationRef.current) return;
      console.warn("[news] load more failed", e);
      setMoreError(true);
    } finally {
      if (loadMoreAbortRef.current === controller) loadMoreAbortRef.current = null;
      setLoadingMore(false);
    }
  }, [nextCursor, loadingMore, filtering, moreError, listError, filters, locale]);

  // IntersectionObserver for infinite scroll (오류 상태에서는 멈춘다)
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || moreError || listError) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore) {
          loadMore();
        }
      },
      { rootMargin: "400px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadMore, hasMore, loadingMore, moreError, listError]);

  const retryList = () => setReloadToken((n) => n + 1);
  const retryMore = () => {
    setMoreError(false);
  };

  // 필터 선택지는 서버가 테이블 전체에서 뽑아 넘겨준 값을 쓴다.
  const categories = facets?.categories ?? [];

  const filterKey = `${selectedCategories.join(",")}-${selectedCountry}-${selectedRegion}-${debouncedQuery}-${dateRange.from || ""}-${dateRange.to || ""}`;

  // 지역 칩은 주소(?region=)에 남겨 공유·새로고침에도 유지한다 (다른 필터는 지금처럼 화면 상태만)
  const handleRegionChange = useCallback((region: RegionChip) => {
    setSelectedRegion(region);
    try {
      const url = new URL(window.location.href);
      if (region === "ALL") url.searchParams.delete("region");
      else url.searchParams.set("region", region);
      window.history.replaceState(window.history.state, "", url.toString());
    } catch {
      /* 주소 갱신 실패는 무시 — 목록 필터는 그대로 동작한다 */
    }
  }, []);

  const handleReset = () => {
    setSearchQuery("");
    setSelectedCountry("ALL");
    handleRegionChange("ALL");
    setSelectedCategories([]);
    setDateRange({});
  };

  const handleViewModeChange = (mode: "grid" | "list") => {
    setViewMode(mode);
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <NewsFilter
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          selectedRegion={selectedRegion}
          onRegionChange={handleRegionChange}
          regionCounts={facets?.regions}
          selectedCategories={selectedCategories}
          onCategoriesChange={setSelectedCategories}
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          categories={categories}
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
          totalCount={0}
          onReset={handleReset}
          autoFocusSearch={autoFocusSearch}
        />
        <NewsContainerSkeleton viewMode={viewMode} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <NewsFilter
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        selectedRegion={selectedRegion}
        onRegionChange={handleRegionChange}
        regionCounts={facets?.regions}
        selectedCategories={selectedCategories}
        onCategoriesChange={setSelectedCategories}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        categories={categories}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        totalCount={total}
        onReset={handleReset}
        autoFocusSearch={autoFocusSearch}
      />

      {/* 진입 애니메이션 없음: 뉴스는 즉시 보여야 한다(스크롤마다 깜박이던 whileInView 제거). */}
      {filtering ? (
        <NewsContainerSkeleton viewMode={viewMode} />
      ) : listError ? (
        <div role="alert" className="py-20 text-center" data-testid="news-list-error">
          <AlertTriangle className="mx-auto mb-4 h-10 w-10 text-destructive" aria-hidden="true" />
          <h3 className="mb-2 text-lg font-semibold text-ink">{t("loadError")}</h3>
          <p className="mb-6 text-sm text-ink-2">{t("loadErrorHint")}</p>
          <Button variant="outline" onClick={retryList}>
            <RotateCw className="mr-2 h-4 w-4" aria-hidden="true" />
            {tc("retry")}
          </Button>
        </div>
      ) : days.length === 0 ? (
        <div className="py-20 text-center">
          <Search className="mx-auto mb-4 h-10 w-10 text-ink-3" aria-hidden="true" />
          <h3 className="mb-2 text-lg font-semibold text-ink">{t("noResults")}</h3>
          <p className="text-sm text-ink-2">{t("noResultsHint")}</p>
        </div>
      ) : (
        <div key={`content-${filterKey}`} className="space-y-12">
          {days.map((day) => (
            <NewsDayGroup
              key={day.date}
              day={day}
              heading={formatDateGroup(day.date, locale)}
              viewMode={viewMode}
              filters={filters}
              locale={locale}
            />
          ))}
        </div>
      )}

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} className="h-1" />
      {loadingMore && (
        <div className="flex items-center justify-center gap-2 py-6 text-ink-3">
          <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
          <span className="text-sm">{t("loadingMore")}</span>
        </div>
      )}
      {moreError && !listError && (
        <div
          role="alert"
          className="flex flex-col sm:flex-row items-center justify-center gap-3 py-6 text-sm text-ink-2"
          data-testid="news-more-error"
        >
          <span className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-destructive" aria-hidden="true" />
            {t("loadMoreError")}
          </span>
          <Button variant="outline" size="sm" onClick={retryMore}>
            <RotateCw className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
            {tc("retry")}
          </Button>
        </div>
      )}
      {/* useSearchParams 를 쓰므로 Suspense 경계 안에 둔다 */}
      <Suspense fallback={null}>
        <DayBriefingDialog />
      </Suspense>
      {!hasMore && !listError && days.length > NEWS_DAYS_PER_PAGE && (
        <p className="text-center text-xs text-ink-3 py-4">
          {t("allDaysLoaded", { total })}
        </p>
      )}
    </div>
  );
}
