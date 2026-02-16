"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
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
import { getCountryLabel } from "@/lib/news-utils";
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
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  
  // Debounce search query
  const debouncedSearch = useDebounce(localSearch, 300);
  
  // Update parent when debounced value changes
  useState(() => {
    if (debouncedSearch !== searchQuery) {
      onSearchChange(debouncedSearch);
    }
  });

  const hasActiveFilter = searchQuery || selectedCountry !== "ALL" || selectedCategory !== "ALL";

  const handleReset = () => {
    setLocalSearch("");
    onReset();
    setIsSheetOpen(false);
  };

  const FilterContent = ({ isMobile = false }: { isMobile?: boolean }) => (
    <div className={`space-y-4 ${isMobile ? "mt-4" : ""}`}>
      {/* Search */}
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

      {/* Country */}
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
              <SelectItem key={code} value={code}>
                {getCountryLabel(code)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Category */}
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
              <SelectItem key={cat} value={cat} className="capitalize">
                {cat}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Reset */}
      {hasActiveFilter && (
        <Button variant="outline" className="w-full" onClick={handleReset}>
          <X className="w-4 h-4 mr-2" />
          {t("reset")}
        </Button>
      )}
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Desktop & Mobile Top Bar */}
      <div className="flex items-center gap-3">
        {/* Desktop Search */}
        <div className="hidden md:block relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
          <Input
            type="text"
            placeholder={t("searchPlaceholder")}
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            className="pl-10"
          />
        </div>

        {/* Mobile Filter Button */}
        <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
          <SheetTrigger asChild className="md:hidden">
            <Button variant="outline" className="flex-1">
              <SlidersHorizontal className="w-4 h-4 mr-2" />
              {t("filters") || "Filters"}
              {hasActiveFilter && (
                <span className="ml-2 w-2 h-2 bg-primary rounded-full" />
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
        <div className="hidden md:flex items-center gap-3 flex-1">
          <Filter className="w-4 h-4 text-muted-foreground" />
          
          <Select value={selectedCountry} onValueChange={onCountryChange}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder={t("country")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t("allCountries")}</SelectItem>
              {countries.map((code) => (
                <SelectItem key={code} value={code}>
                  {getCountryLabel(code)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={selectedCategory} onValueChange={onCategoryChange}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder={t("category")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t("allCategories")}</SelectItem>
              {categories.map((cat) => (
                <SelectItem key={cat} value={cat} className="capitalize">
                  {cat}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {hasActiveFilter && (
            <Button variant="ghost" size="sm" onClick={handleReset}>
              <X className="w-3 h-3 mr-1" />
              {t("reset")}
            </Button>
          )}
        </div>

        {/* View Mode Toggle */}
        <div className="flex items-center border rounded-md p-0.5">
          <Button
            variant={viewMode === "grid" ? "default" : "ghost"}
            size="icon"
            className="h-8 w-8"
            onClick={() => onViewModeChange("grid")}
          >
            <Grid3X3 className="h-4 w-4" />
          </Button>
          <Button
            variant={viewMode === "list" ? "default" : "ghost"}
            size="icon"
            className="h-8 w-8"
            onClick={() => onViewModeChange("list")}
          >
            <List className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Total Count */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">
          {t("totalCount", { count: totalCount })}
        </span>
        {hasActiveFilter && (
          <span className="text-xs text-muted-foreground md:hidden">
            {t("activeFilters") || "Active filters"}
          </span>
        )}
      </div>
    </div>
  );
}
