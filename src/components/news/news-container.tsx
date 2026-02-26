"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { useLocale } from "next-intl";
import { Search, CalendarDays, Loader2 } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { NewsItem } from "@/lib/supabase";
import { NEWS_PAGE_SIZE } from "@/lib/supabase";
import { fetchNewsPageClient } from "@/lib/supabase-client";
import {
  filterNews,
  getUniqueCountries,
  getUniqueCategories,
  groupNewsByDate,
  formatDateGroup,
} from "@/lib/news-utils";
import type { DateRange } from "@/lib/news-utils";
import { NewsCard } from "./news-card";
import { NewsListItem } from "./news-list-item";
import { NewsFilter } from "./news-filter";
import { NewsContainerSkeleton } from "./news-skeleton";
import { NewsDetailModal } from "./news-detail-modal";

interface NewsContainerProps {
  news: NewsItem[];
  isLoading?: boolean;
}

const springTransition = {
  type: "spring" as const,
  stiffness: 100,
  damping: 15,
};

export function NewsContainer({ news: initialNews, isLoading = false }: NewsContainerProps) {
  const locale = useLocale();
  const [allNews, setAllNews] = useState<NewsItem[]>(initialNews);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(initialNews.length >= NEWS_PAGE_SIZE);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCountry, setSelectedCountry] = useState("ALL");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<DateRange>({});
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [selectedItem, setSelectedItem] = useState<NewsItem | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Sync if initialNews changes (e.g. revalidation)
  useEffect(() => {
    setAllNews(initialNews);
    setHasMore(initialNews.length >= NEWS_PAGE_SIZE);
  }, [initialNews]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const nextPage = await fetchNewsPageClient(allNews.length, NEWS_PAGE_SIZE);
      if (nextPage.length === 0) {
        setHasMore(false);
      } else {
        if (nextPage.length < NEWS_PAGE_SIZE) setHasMore(false);
        setAllNews((prev) => {
          const existingIds = new Set(prev.map((n) => n.id));
          const newItems = nextPage.filter((n) => !existingIds.has(n.id));
          return [...prev, ...newItems];
        });
      }
    } finally {
      setLoadingMore(false);
    }
  }, [allNews.length, loadingMore, hasMore]);

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

  const countries = useMemo(() => getUniqueCountries(allNews), [allNews]);
  const categories = useMemo(() => getUniqueCategories(allNews), [allNews]);

  const filteredNews = useMemo(
    () => filterNews(allNews, searchQuery, selectedCountry, selectedCategories, locale, dateRange),
    [allNews, searchQuery, selectedCountry, selectedCategories, locale, dateRange]
  );

  const dateGroups = useMemo(
    () => groupNewsByDate(filteredNews),
    [filteredNews]
  );

  const filterKey = `${selectedCategories.join(",")}-${selectedCountry}-${searchQuery}-${dateRange.from || ""}-${dateRange.to || ""}`;

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
        totalCount={filteredNews.length}
        onReset={handleReset}
      />

      <AnimatePresence mode="wait">
        {filteredNews.length === 0 ? (
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
            ? `총 ${allNews.length}건의 기사를 모두 불러왔습니다`
            : locale === "zh"
              ? `已加载全部 ${allNews.length} 篇文章`
              : `All ${allNews.length} articles loaded`}
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
