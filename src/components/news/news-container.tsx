"use client";

import { useState, useMemo } from "react";
import { useLocale } from "next-intl";
import { Loader2, Search } from "lucide-react";
import type { NewsItem } from "@/lib/supabase";
import { filterNews, getUniqueCountries, getUniqueCategories } from "@/lib/news-utils";
import { NewsCard } from "./news-card";
import { NewsListItem } from "./news-list-item";
import { NewsFilter } from "./news-filter";

export function NewsContainer({ news }: { news: NewsItem[] }) {
  const locale = useLocale();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCountry, setSelectedCountry] = useState("ALL");
  const [selectedCategory, setSelectedCategory] = useState("ALL");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  const countries = useMemo(() => getUniqueCountries(news), [news]);
  const categories = useMemo(() => getUniqueCategories(news), [news]);

  const filteredNews = useMemo(
    () => filterNews(news, searchQuery, selectedCountry, selectedCategory, locale),
    [news, searchQuery, selectedCountry, selectedCategory, locale]
  );

  const handleReset = () => {
    setSearchQuery("");
    setSelectedCountry("ALL");
    setSelectedCategory("ALL");
  };

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
        onViewModeChange={setViewMode}
        totalCount={filteredNews.length}
        onReset={handleReset}
      />

      {filteredNews.length === 0 ? (
        <div className="text-center py-20">
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
        </div>
      ) : viewMode === "grid" ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredNews.map((item) => (
            <NewsCard key={item.id} item={item} />
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredNews.map((item) => (
            <NewsListItem key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
