"use client";

import { useState, useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Search, Filter, X, Grid3X3, List, SlidersHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { getCountryLabel, getCategoryLabel } from "@/lib/news-utils";
import { useDebounce } from "@/hooks/use-debounce";

interface NewsFilterProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  selectedCountry: string;
  onCountryChange: (value: string) => void;
  selectedCategory: string;
  onCategoryChange: (value: string) => void;
  countries: string[];
  categories: string[];
  viewMode: "grid" | "list";
  onViewModeChange: (mode: "grid" | "list") => void;
  totalCount: number;
  onReset: () => void;
}

export function NewsFilter({
  searchQuery,
  onSearchChange,
  selectedCountry,
  onCountryChange,
  selectedCategory,
  onCategoryChange,
  countries,
  categories,
  viewMode,
  onViewModeChange,
  totalCount,
  onReset,
}: NewsFilterProps) {
  const t = useTranslations("filter");
  const locale = useLocale();
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const [isSheetOpen, setIsSheetOpen] = useState(false);

  const debouncedSearch = useDebounce(localSearch, 300);

  useEffect(() => {
    if (debouncedSearch !== searchQuery) {
      onSearchChange(debouncedSearch);
    }
  }, [debouncedSearch]);

  const hasActiveFilter = searchQuery || selectedCountry !== "ALL" || selectedCategory !== "ALL";

  const handleReset = () => {
    setLocalSearch("");
    onReset();
    setIsSheetOpen(false);
  };

  const FilterContent = ({ isMobile = false }: { isMobile?: boolean }) => (
    <div className={`space-y-4 ${isMobile ? "mt-4" : ""}`}>
      <div className="space-y-2">
        <label className="text-sm font-medium">{t("search") || "Search"}</label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
          <Input
            type="text"
            placeholder={t("searchPlaceholder")}
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">{t("country")}</label>
        <Select value={selectedCountry} onValueChange={(value) => {
          onCountryChange(value);
          if (isMobile) setIsSheetOpen(false);
        }}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={t("allCountries")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t("allCountries")}</SelectItem>
            {countries.map((code) => (
              <SelectItem key={code} value={code}>{getCountryLabel(code)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">{t("category")}</label>
        <Select value={selectedCategory} onValueChange={(value) => {
          onCategoryChange(value);
          if (isMobile) setIsSheetOpen(false);
        }}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={t("allCategories")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t("allCategories")}</SelectItem>
            {categories.map((cat) => (
              <SelectItem key={cat} value={cat}>{getCategoryLabel(cat, locale)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {hasActiveFilter && (
        <Button variant="outline" className="w-full" onClick={handleReset}>
          <X className="w-4 h-4 mr-2" />
          {t("reset")}
        </Button>
      )}
    </div>
  );

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <div className="flex items-center gap-2 p-2 rounded-xl border border-border/50 bg-card/30 backdrop-blur-sm">
        {/* Desktop Search */}
        <div className="hidden md:block relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground/60 w-4 h-4" />
          <Input
            type="text"
            placeholder={t("searchPlaceholder")}
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            className="pl-10 border-0 bg-transparent shadow-none focus-visible:ring-0 placeholder:text-muted-foreground/40"
          />
        </div>

        {/* Mobile Filter */}
        <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
          <SheetTrigger asChild className="md:hidden">
            <Button variant="ghost" className="flex-1 text-muted-foreground">
              <SlidersHorizontal className="w-4 h-4 mr-2" />
              {t("filters") || "Filters"}
              {hasActiveFilter && (
                <span className="ml-2 w-1.5 h-1.5 bg-primary rounded-full" />
              )}
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[300px]">
            <SheetHeader>
              <SheetTitle>{t("filters") || "Filters"}</SheetTitle>
            </SheetHeader>
            <FilterContent isMobile />
          </SheetContent>
        </Sheet>

        {/* Desktop Filters */}
        <div className="hidden md:flex items-center gap-2">
          <div className="w-px h-5 bg-border/50" />
          <Filter className="w-3.5 h-3.5 text-muted-foreground/50" />

          <Select value={selectedCountry} onValueChange={onCountryChange}>
            <SelectTrigger className="w-[130px] h-8 text-xs border-0 bg-transparent shadow-none">
              <SelectValue placeholder={t("country")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t("allCountries")}</SelectItem>
              {countries.map((code) => (
                <SelectItem key={code} value={code}>{getCountryLabel(code)}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={selectedCategory} onValueChange={onCategoryChange}>
            <SelectTrigger className="w-[130px] h-8 text-xs border-0 bg-transparent shadow-none">
              <SelectValue placeholder={t("category")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t("allCategories")}</SelectItem>
              {categories.map((cat) => (
                <SelectItem key={cat} value={cat}>{getCategoryLabel(cat, locale)}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          {hasActiveFilter && (
            <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={handleReset}>
              <X className="w-3 h-3 mr-1" />
              {t("reset")}
            </Button>
          )}
        </div>

        <div className="w-px h-5 bg-border/50" />

        {/* View Toggle */}
        <div className="flex items-center rounded-lg p-0.5">
          <Button
            variant={viewMode === "grid" ? "secondary" : "ghost"}
            size="icon"
            className="h-7 w-7"
            onClick={() => onViewModeChange("grid")}
          >
            <Grid3X3 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant={viewMode === "list" ? "secondary" : "ghost"}
            size="icon"
            className="h-7 w-7"
            onClick={() => onViewModeChange("list")}
          >
            <List className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Count */}
      <div className="flex items-center justify-between px-1">
        <span className="text-xs text-muted-foreground/60">
          {t("totalCount", { count: totalCount })}
        </span>
      </div>
    </div>
  );
}
