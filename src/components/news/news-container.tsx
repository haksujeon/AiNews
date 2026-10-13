"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Search, CalendarDays, Loader2, AlertTriangle, RotateCw } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
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

const springTransition = {
  type: "spring" as const,
  stiffness: 100,
  damping: 15,
};

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

      <AnimatePresence mode="wait">
        {filtering ? (
          <NewsContainerSkeleton viewMode={viewMode} />
        ) : listError ? (
          <motion.div
            key="error"
            role="alert"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
            className="text-center py-20"
            data-testid="news-list-error"
          >
            <AlertTriangle className="w-12 h-12 text-destructive/80 mx-auto mb-4" aria-hidden="true" />
            <h3 className="text-lg font-semibold mb-2">{t("loadError")}</h3>
            <p className="text-sm text-muted-foreground mb-6">{t("loadErrorHint")}</p>
            <Button variant="outline" onClick={retryList}>
              <RotateCw className="w-4 h-4 mr-2" aria-hidden="true" />
              {tc("retry")}
            </Button>
          </motion.div>
        ) : allNews.length === 0 ? (
          <motion.div
            key="empty"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.3 }}
            className="text-center py-20"
          >
            <Search className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-muted-foreground mb-2">
              {t("noResults")}
            </h3>
            <p className="text-sm text-muted-foreground">{t("noResultsHint")}</p>
          </motion.div>
        ) : (
          <motion.div
            key={`content-${filterKey}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="space-y-8"
          >
            {dateGroups.map((group) => (
              <motion.section
                key={group.date}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={springTransition}
                className="space-y-4"
              >
                <div className="flex items-center gap-3 mb-4">
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-card/40 border border-border/30 backdrop-blur-sm">
                    <CalendarDays className="w-3.5 h-3.5 text-primary/60" />
                    <h3 className="text-xs font-medium text-muted-foreground">
                      {group.date === "unknown"
                        ? t("unknownDate")
                        : formatDateGroup(group.date, locale)}
                    </h3>
                    <span className="text-[10px] text-muted-foreground/50">
                      {group.items.length}
                    </span>
                  </div>
                  <div className="flex-1 h-px bg-gradient-to-r from-border/30 to-transparent" />
                </div>

                <AnimatePresence mode="wait">
                  {viewMode === "grid" ? (
                    <motion.div
                      key="grid"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
                    >
                      {group.items.map((item) => (
                        <motion.div
                          key={item.id}
                          initial={{ opacity: 0, y: 20 }}
                          whileInView={{ opacity: 1, y: 0 }}
                          viewport={{ once: true }}
                          transition={springTransition}
                        >
                          <NewsCard item={item} />
                        </motion.div>
                      ))}
                    </motion.div>
                  ) : (
                    <motion.div
                      key="list"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="space-y-4"
                    >
                      {group.items.map((item) => (
                        <motion.div
                          key={item.id}
                          initial={{ opacity: 0, x: -20 }}
                          whileInView={{ opacity: 1, x: 0 }}
                          viewport={{ once: true }}
                          transition={springTransition}
                        >
                          <NewsListItem item={item} />
                        </motion.div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.section>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Infinite scroll sentinel */}
      <div ref={sentinelRef} className="h-1" />
      {loadingMore && (
        <div className="flex items-center justify-center gap-2 py-6 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span className="text-sm">{t("loadingMore")}</span>
        </div>
      )}
      {moreError && !listError && (
        <div
          role="alert"
          className="flex flex-col sm:flex-row items-center justify-center gap-3 py-6 text-sm text-muted-foreground"
          data-testid="news-more-error"
        >
          <span className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-destructive/80" aria-hidden="true" />
            {t("loadMoreError")}
          </span>
          <Button variant="outline" size="sm" onClick={retryMore}>
            <RotateCw className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
            {tc("retry")}
          </Button>
        </div>
      )}
      {!hasMore && !listError && allNews.length > NEWS_PAGE_SIZE && (
        <p className="text-center text-xs text-muted-foreground/50 py-4">
          {t("allLoaded", { total })}
        </p>
      )}
    </div>
  );
}
