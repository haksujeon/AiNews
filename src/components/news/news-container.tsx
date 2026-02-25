"use client";

import { useState, useMemo } from "react";
import { useLocale } from "next-intl";
import { Search, CalendarDays } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { NewsItem } from "@/lib/supabase";
import {
  filterNews,
  getUniqueCountries,
  getUniqueCategories,
  groupNewsByDate,
  formatDateGroup,
} from "@/lib/news-utils";
import { NewsCard } from "./news-card";
import { NewsListItem } from "./news-list-item";
import { NewsFilter } from "./news-filter";
import { NewsContainerSkeleton } from "./news-skeleton";
import { NewsDetailModal } from "./news-detail-modal";

interface NewsContainerProps {
  news: NewsItem[];
  isLoading?: boolean;
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.05,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      type: "spring" as const,
      stiffness: 100,
      damping: 15,
    },
  },
};

const listVariants = {
  hidden: { opacity: 0, x: -20 },
  visible: {
    opacity: 1,
    x: 0,
    transition: {
      type: "spring" as const,
      stiffness: 100,
      damping: 15,
    },
  },
};

export function NewsContainer({ news, isLoading = false }: NewsContainerProps) {
  const locale = useLocale();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCountry, setSelectedCountry] = useState("ALL");
  const [selectedCategory, setSelectedCategory] = useState("ALL");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [selectedItem, setSelectedItem] = useState<NewsItem | null>(null);

  const countries = useMemo(() => getUniqueCountries(news), [news]);
  const categories = useMemo(() => getUniqueCategories(news), [news]);

  const filteredNews = useMemo(
    () => filterNews(news, searchQuery, selectedCountry, selectedCategory, locale),
    [news, searchQuery, selectedCountry, selectedCategory, locale]
  );

  const dateGroups = useMemo(
    () => groupNewsByDate(filteredNews),
    [filteredNews]
  );

  const handleReset = () => {
    setSearchQuery("");
    setSelectedCountry("ALL");
    setSelectedCategory("ALL");
  };

  // Handle view mode change
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
          selectedCategory={selectedCategory}
          onCategoryChange={setSelectedCategory}
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
        selectedCategory={selectedCategory}
        onCategoryChange={setSelectedCategory}
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
                ? "다른 검색어나 필터를 시도핤봐세요."
                : locale === "zh"
                  ? "请尝试其他搜索词或筛选条件。"
                  : "Try different search terms or filters."}
            </p>
          </motion.div>
        ) : (
          <motion.div
            key="content"
            initial="hidden"
            animate="visible"
            exit={{ opacity: 0 }}
            variants={containerVariants}
            className="space-y-8"
          >
            {dateGroups.map((group) => (
              <motion.section
                key={group.date}
                variants={itemVariants}
                className="space-y-4"
              >
                <div className="flex items-center gap-2 mb-4 pb-2 border-b">
                  <CalendarDays className="w-4 h-4 text-muted-foreground" />
                  <h3 className="text-sm font-semibold text-muted-foreground">
                    {group.date === "unknown"
                      ? locale === "ko"
                        ? "날짜 미지정"
                        : locale === "zh"
                          ? "日期未指定"
                          : "Unknown date"
                      : formatDateGroup(group.date, locale)}
                  </h3>
                  <span className="text-xs text-muted-foreground">
                    ({group.items.length})
                  </span>
                </div>
                
                <AnimatePresence mode="wait">
                  {viewMode === "grid" ? (
                    <motion.div
                      key="grid"
                      initial="hidden"
                      animate="visible"
                      exit={{ opacity: 0 }}
                      variants={containerVariants}
                      className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
                    >
                      {group.items.map((item) => (
                        <motion.div
                          key={item.id}
                          variants={itemVariants}
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
                      initial="hidden"
                      animate="visible"
                      exit={{ opacity: 0 }}
                      variants={containerVariants}
                      className="space-y-4"
                    >
                      {group.items.map((item) => (
                        <motion.div key={item.id} variants={listVariants}>
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
