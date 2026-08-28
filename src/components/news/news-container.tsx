"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useLocale } from "next-intl";
import { Search, CalendarDays, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { NewsItem } from "@/lib/news-types";
import { NEWS_PAGE_SIZE } from "@/lib/news-types";
import { fetchNewsPageClient } from "@/lib/supabase-client";
import { groupNewsByDate, formatDateGroup } from "@/lib/news-utils";
import type { DateRange } from "@/lib/news-utils";
import type { NewsFilters } from "@/lib/news-query";
import { useDebounce } from "@/hooks/use-debounce";
import { NewsCard } from "./news-card";
import { NewsListItem } from "./news-list-item";
import { NewsFilter } from "./news-filter";
import { NewsContainerSkeleton } from "./news-skeleton";
import { NewsDetailModal } from "./news-detail-modal";

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

export function NewsContainer({
  news: initialNews,
  initialTotal,
  facets,
  isLoading = false,
}: NewsContainerProps) {
  const locale = useLocale();
  const [allNews, setAllNews] = useState<NewsItem[]>(initialNews);
  const [total, setTotal] = useState(initialTotal ?? initialNews.length);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filtering, setFiltering] = useState(false);
  const [hasMore, setHasMore] = useState(initialNews.length >= NEWS_PAGE_SIZE);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCountry, setSelectedCountry] = useState("ALL");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<DateRange>({});
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [selectedItem, setSelectedItem] = useState<NewsItem | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

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
    if (skipFirstFetch.current && isInitialFilters) {
      skipFirstFetch.current = false;
      return;
    }
    skipFirstFetch.current = false;

    let cancelled = false;
    setFiltering(true);
    fetchNewsPageClient(0, NEWS_PAGE_SIZE, filters)
      .then((page) => {
        if (cancelled) return;
        setAllNews(page.items);
        setTotal(page.total);
        setHasMore(page.items.length < page.total);
      })
      .finally(() => {
        if (!cancelled) setFiltering(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filters, isInitialFilters]);

  // Sync if initialNews changes (e.g. revalidation)
  useEffect(() => {
    setAllNews(initialNews);
    setTotal(initialTotal ?? initialNews.length);
    setHasMore(initialNews.length >= NEWS_PAGE_SIZE);
  }, [initialNews, initialTotal]);

  const loadMore = useCallback(async () => {
    if (loadingMore || filtering || !hasMore) return;
    setLoadingMore(true);
    try {
      // 현재 필터를 유지한 채 다음 페이지를 받는다.
      const page = await fetchNewsPageClient(allNews.length, NEWS_PAGE_SIZE, filters);
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
    } finally {
      setLoadingMore(false);
    }
  }, [allNews.length, loadingMore, filtering, hasMore, filters]);

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

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
  }, [loadMore, hasMore, loadingMore]);

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
              {locale === "ko"
                ? "검색 결과가 없습니다"
                : locale === "zh"
                  ? "没有搜索结果"
                  : "No results found"}
            </h3>
            <p className="text-sm text-muted-foreground">
              {locale === "ko"
                ? "다른 검색어나 필터를 시도해보세요."
                : locale === "zh"
                  ? "请尝试其他搜索词或筛选条件。"
                  : "Try different search terms or filters."}
            </p>
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
                        ? locale === "ko"
                          ? "날짜 미지정"
                          : locale === "zh"
                            ? "日期未指定"
                            : "Unknown date"
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
                          <NewsCard
                            item={item}
                            onClick={() => setSelectedItem(item)}
                          />
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
                          <NewsListItem item={item} onClick={() => setSelectedItem(item)} />
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
          <span className="text-sm">
            {locale === "ko" ? "불러오는 중..." : locale === "zh" ? "加载中..." : "Loading more..."}
          </span>
        </div>
      )}
      {!hasMore && allNews.length > NEWS_PAGE_SIZE && (
        <p className="text-center text-xs text-muted-foreground/50 py-4">
          {locale === "ko"
            ? `총 ${total}건의 기사를 모두 불러왔습니다`
            : locale === "zh"
              ? `已加载全部 ${total} 篇文章`
              : `All ${total} articles loaded`}
        </p>
      )}

      <NewsDetailModal
        news={selectedItem}
        open={!!selectedItem}
        onOpenChange={(open) => {
          if (!open) setSelectedItem(null);
        }}
        onSelectNews={(item) => setSelectedItem(item)}
      />
    </div>
  );
}
