"use client";

import { useTranslations } from "next-intl";
import { Search, Filter, X, Grid3X3, List } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getCountryLabel } from "@/lib/news-utils";

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
  const hasActiveFilter = searchQuery || selectedCountry !== "ALL" || selectedCategory !== "ALL";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" />
          <Input
            type="text"
            placeholder={t("searchPlaceholder")}
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
            className="pl-10"
          />
        </div>

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

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-muted-foreground" />
        </div>

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
          <Button variant="ghost" size="sm" onClick={onReset}>
            <X className="w-3 h-3 mr-1" />
            {t("reset")}
          </Button>
        )}

        <span className="text-sm text-muted-foreground ml-auto">
          {t("totalCount", { count: totalCount })}
        </span>
      </div>
    </div>
  );
}
