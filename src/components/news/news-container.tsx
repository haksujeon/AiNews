"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Search, Loader2, AlertTriangle, RotateCw } from "lucide-react";
import type { NewsItem } from "@/lib/news-types";
import { NEWS_PAGE_SIZE } from "@/lib/news-types";
import { fetchNewsPageClient, isAbortError } from "@/lib/supabase-client";
import { groupNewsByDate, formatDateGroup } from "@/lib/news-utils";
import type { DateRange } from "@/lib/news-utils";
import type { NewsFilters } from "@/lib/news-query";
import { useDebounce } from "@/hooks/use-debounce";
import { Button } from "@/components/ui/button";
import { NewsCard } from "./news-card";
import { NewsListItem } from "./news-list-item";
import { NewsFilter } from "./news-filter";
import { NewsContainerSkeleton } from "./news-skeleton";

interface NewsContainerProps {
  news: NewsItem[];
  /** 필터 조건에 맞는 전체 건수 (로드된 개수가 아님) */
  initialTotal?: number;
  /** 테이블 전체 기준 필터 선택지 */
  facets?: { countries: string[]; categories: string[] };
  isLoading?: boolean;
}

// 기사 상세는 카드/리스트 항목의 링크(/news/[id])로 연다.
// 소프트 이동이면 @modal/(.)news/[id] 가 모달로 가로채고, 직접 접속이면 전체 페이지가 뜬다.
// (예전의 selectedItem 상태 기반 모달은 제거 — 모든 진입점이 같은 경로를 쓴다)
export function NewsContainer({
  news: initialNews,
  initialTotal,
  facets,
  isLoading = false,
}: NewsContainerProps) {
  const locale = useLocale();
  const t = useTranslations("list");
  const tc = useTranslations("common");
  const [allNews, setAllNews] = useState<NewsItem[]>(initialNews);
  const [total, setTotal] = useState(initialTotal ?? initialNews.length);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const [hasMore, setHasMore] = useState(initialNews.length >= NEWS_PAGE_SIZE);
  // 첫 페이지(필터 변경) 실패 / 추가 로드 실패를 따로 관리한다.
  // moreError 가 있으면 무한 스크롤을 멈춰 재시도 루프를 막는다.
  const [listError, setListError] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCountry, setSelectedCountry] = useState("ALL");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<DateRange>({});
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const sentinelRef = useRef<HTMLDivElement>(null);
  // 필터가 바뀔 때마다 증가. 이전 세대의 응답(추가 로드 포함)은 버린다.
  const generationRef = useRef(0);
  const loadMoreAbortRef = useRef<AbortController | null>(null);

  // 검색어는 타이핑마다 요청하지 않도록 디바운스한다.
  const debouncedQuery = useDebounce(searchQuery, 350);

  const filters: NewsFilters = useMemo(
    () => ({
      q: debouncedQuery,
      country: selectedCountry,
      categories: selectedCategories,
      from: dateRange.from ?? "",
      to: dateRange.to ?? "",
    }),
    [debouncedQuery, selectedCountry, selectedCategories, dateRange.from, dateRange.to]
  );

  // 필터가 바뀌면 서버에서 첫 페이지를 다시 받아온다.
  // 초기 렌더(필터 없음)는 서버 컴포넌트가 이미 준 데이터를 쓰므로 건너뛴다.
  const isInitialFilters =
    !filters.q &&
    filters.country === "ALL" &&
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
    fetchNewsPageClient(0, NEWS_PAGE_SIZE, filters, controller.signal)
      .then((page) => {
        if (generation !== generationRef.current) return;
        setAllNews(page.items);
        setTotal(page.total);
        setHasMore(page.items.length < page.total);
      })
      .catch((e) => {
        if (isAbortError(e) || generation !== generationRef.current) return;
        console.warn("[news] list fetch failed", e);
        setListError(true);
        setHasMore(false);
      })
      .finally(() => {
        if (generation === generationRef.current) setFiltering(false);
      });
    return () => {
      controller.abort();
    };
  }, [filters, isInitialFilters, reloadToken]);

  // Sync if initialNews changes (e.g. revalidation)
  useEffect(() => {
    setAllNews(initialNews);
    setTotal(initialTotal ?? initialNews.length);
    setHasMore(initialNews.length >= NEWS_PAGE_SIZE);
  }, [initialNews, initialTotal]);

  const loadMore = useCallback(async () => {
    if (loadingMore || filtering || !hasMore || moreError || listError) return;
    const generation = generationRef.current;
    const controller = new AbortController();
    loadMoreAbortRef.current = controller;
    setLoadingMore(true);
    try {
      // 현재 필터를 유지한 채 다음 페이지를 받는다.
      const page = await fetchNewsPageClient(allNews.length, NEWS_PAGE_SIZE, filters, controller.signal);
      // 그 사이 필터가 바뀌었으면 이 결과는 다른 목록의 것이므로 버린다.
      if (generation !== generationRef.current) return;
      if (page.items.length === 0) {
        setHasMore(false);
      } else {
        setTotal(page.total);
        setAllNews((prev) => {
          const existingIds = new Set(prev.map((n) => n.id));
          const merged = [...prev, ...page.items.filter((n) => !existingIds.has(n.id))];
          setHasMore(merged.length < page.total);
          return merged;
        });
      }
    } catch (e) {
      if (isAbortError(e) || generation !== generationRef.current) return;
      console.warn("[news] load more failed", e);
      setMoreError(true);
    } finally {
      if (loadMoreAbortRef.current === controller) loadMoreAbortRef.current = null;
      setLoadingMore(false);
    }
  }, [allNews.length, loadingMore, filtering, hasMore, moreError, listError, filters]);

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
  const countries = facets?.countries ?? [];
  const categories = facets?.categories ?? [];

  // 필터링은 서버(SQL)에서 끝났으므로 allNews 가 곧 결과다.
  const dateGroups = useMemo(() => groupNewsByDate(allNews), [allNews]);

  const filterKey = `${selectedCategories.join(",")}-${selectedCountry}-${debouncedQuery}-${dateRange.from || ""}-${dateRange.to || ""}`;

  const handleReset = () => {
    setSearchQuery("");
    setSelectedCountry("ALL");
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
          selectedCountry={selectedCountry}
          onCountryChange={setSelectedCountry}
          selectedCategories={selectedCategories}
          onCategoriesChange={setSelectedCategories}
          dateRange={dateRange}
          onDateRangeChange={setDateRange}
          countries={countries}
          categories={categories}
          viewMode={viewMode}
          onViewModeChange={handleViewModeChange}
          totalCount={0}
          onReset={handleReset}
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
        selectedCountry={selectedCountry}
        onCountryChange={setSelectedCountry}
        selectedCategories={selectedCategories}
        onCategoriesChange={setSelectedCategories}
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        countries={countries}
        categories={categories}
        viewMode={viewMode}
        onViewModeChange={handleViewModeChange}
        totalCount={total}
        onReset={handleReset}
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
      ) : allNews.length === 0 ? (
        <div className="py-20 text-center">
          <Search className="mx-auto mb-4 h-10 w-10 text-ink-3" aria-hidden="true" />
          <h3 className="mb-2 text-lg font-semibold text-ink">{t("noResults")}</h3>
          <p className="text-sm text-ink-2">{t("noResultsHint")}</p>
        </div>
      ) : (
        <div key={`content-${filterKey}`} className="space-y-12">
          {dateGroups.map((group) => (
            <section key={group.date} aria-labelledby={`date-${group.date}`}>
              <div className="mb-2 flex items-baseline justify-between gap-4 border-b-2 border-rule-strong pb-2">
                <h3 id={`date-${group.date}`} className="text-[15px] font-bold text-ink">
                  {group.date === "unknown"
                    ? t("unknownDate")
                    : formatDateGroup(group.date, locale)}
                </h3>
                <span className="text-xs text-ink-3">
                  {t("groupCount", { count: group.items.length })}
                </span>
              </div>

              {viewMode === "grid" ? (
                <div className="grid grid-cols-1 gap-x-8 gap-y-8 pt-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {group.items.map((item) => (
                    <NewsCard key={item.id} item={item} />
                  ))}
                </div>
              ) : (
                <div>
                  {group.items.map((item) => (
                    <NewsListItem key={item.id} item={item} />
                  ))}
                </div>
              )}
            </section>
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
      {!hasMore && !listError && allNews.length > NEWS_PAGE_SIZE && (
        <p className="text-center text-xs text-ink-3 py-4">
          {t("allLoaded", { total })}
        </p>
      )}
    </div>
  );
}
