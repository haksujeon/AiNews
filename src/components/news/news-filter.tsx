"use client";

import { useState, useEffect } from "react";
import { useTranslations, useLocale } from "next-intl";
import { Search, X, Grid3X3, List, SlidersHorizontal, CalendarDays } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { getCategoryLabel } from "@/lib/news-utils";
import { REGION_CHIPS, type RegionChip } from "@/lib/region";
import { RegionFlag } from "./region-flag";
import type { RegionCounts } from "@/lib/metrics/period";
import type { DateRange } from "@/lib/news-utils";
import { useDebounce } from "@/hooks/use-debounce";
import type { DateRange as RdpDateRange } from "react-day-picker";

interface NewsFilterProps {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  selectedRegion: RegionChip;
  onRegionChange: (value: RegionChip) => void;
  /** 지역 칩별 건수 (fetchNewsFacets). 판정된 기사가 하나도 없으면 칩을 그리지 않는다 */
  regionCounts?: RegionCounts;
  selectedCategories: string[];
  onCategoriesChange: (value: string[]) => void;
  dateRange: DateRange;
  onDateRangeChange: (range: DateRange) => void;
  categories: string[];
  viewMode: "grid" | "list";
  onViewModeChange: (mode: "grid" | "list") => void;
  totalCount: number;
  onReset: () => void;
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatShortDate(dateStr: string, locale: string): string {
  const [, m, d] = dateStr.split("-");
  if (locale === "ko") return `${parseInt(m)}/${parseInt(d)}`;
  if (locale === "zh") return `${parseInt(m)}月${parseInt(d)}日`;
  return `${parseInt(m)}/${parseInt(d)}`;
}

export function NewsFilter({
  searchQuery,
  onSearchChange,
  selectedRegion,
  onRegionChange,
  regionCounts,
  selectedCategories,
  onCategoriesChange,
  dateRange,
  onDateRangeChange,
  categories,
  viewMode,
  onViewModeChange,
  totalCount,
  onReset,
}: NewsFilterProps) {
  const t = useTranslations("filter");
  const tc = useTranslations("common");
  const locale = useLocale();
  const [localSearch, setLocalSearch] = useState(searchQuery);
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);

  const debouncedSearch = useDebounce(localSearch, 300);

  useEffect(() => {
    if (debouncedSearch !== searchQuery) {
      onSearchChange(debouncedSearch);
    }
  }, [debouncedSearch]);

  // 지역 칩 (예전 국가 선택 칸을 대신한다 — 수집 매체가 모두 중국이라 '국가'는 정보가 없었다, P0-5).
  // 기사 주체의 나라(subject_region)로 거른다. 판정된 기사가 없으면 칩을 그리지 않는다.
  const showRegion = (regionCounts?.classified ?? 0) > 0 || selectedRegion !== "ALL";
  const hasDateFilter = !!dateRange.from || !!dateRange.to;
  const hasActiveFilter = searchQuery || selectedRegion !== "ALL" || selectedCategories.length > 0 || hasDateFilter;

  const handleReset = () => {
    setLocalSearch("");
    onReset();
    setIsSheetOpen(false);
  };

  const toggleCategory = (cat: string) => {
    if (selectedCategories.includes(cat)) {
      onCategoriesChange(selectedCategories.filter((c) => c !== cat));
    } else {
      onCategoriesChange([...selectedCategories, cat]);
    }
  };

  // Convert between our DateRange and react-day-picker DateRange
  const rdpRange: RdpDateRange | undefined = (dateRange.from || dateRange.to)
    ? {
        from: dateRange.from ? new Date(dateRange.from + "T00:00:00") : undefined,
        to: dateRange.to ? new Date(dateRange.to + "T00:00:00") : undefined,
      }
    : undefined;

  const handleRdpSelect = (range: RdpDateRange | undefined) => {
    onDateRangeChange({
      from: range?.from ? toDateStr(range.from) : undefined,
      to: range?.to ? toDateStr(range.to) : undefined,
    });
  };

  const dateLabel = hasDateFilter
    ? dateRange.from && dateRange.to
      ? `${formatShortDate(dateRange.from, locale)} ~ ${formatShortDate(dateRange.to, locale)}`
      : dateRange.from
        ? `${formatShortDate(dateRange.from, locale)} ~`
        : `~ ${formatShortDate(dateRange.to!, locale)}`
    : t("dateRange");

  const CategoryChips = () => (
    <div className="flex flex-wrap gap-1.5">
      {categories.map((cat) => {
        const isSelected = selectedCategories.includes(cat);
        // 색 구분 없이 잉크 하나로: 선택 = 잉크 바탕, 미선택 = 괘선 테두리
        return (
          <button
            key={cat}
            type="button"
            data-testid="category-chip"
            data-category={cat}
            aria-pressed={isSelected}
            onClick={() => toggleCategory(cat)}
            className={`
              inline-flex items-center px-2.5 py-1 rounded-sm text-[13px] font-medium
              transition-colors duration-150 border
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
              ${isSelected
                ? "bg-ink text-background border-ink"
                : "bg-transparent text-ink-2 border-rule hover:border-ink-3 hover:text-ink"
              }
            `}
          >
            {getCategoryLabel(cat, locale)}
          </button>
        );
      })}
    </div>
  );

  // 지역 칩: 하나만 고른다(전체 · 중국 · 미국 · 그 밖). 분류 칩과 같은 모양 — 잉크 바탕 = 선택.
  // 렌더 중 컴포넌트를 새로 만들지 않도록 JSX 를 돌려주는 함수로 둔다.
  const renderRegionChips = (isMobile = false) => (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("region")} title={t("regionHint")}>
      {REGION_CHIPS.map((r) => {
        const isSelected = selectedRegion === r;
        return (
          <button
            key={r}
            type="button"
            data-testid="region-chip"
            data-region={r}
            aria-pressed={isSelected}
            onClick={() => {
              onRegionChange(r);
              if (isMobile) setIsSheetOpen(false);
            }}
            className={`
              inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm text-[13px] font-medium
              transition-colors duration-150 border
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
              ${isSelected
                ? "bg-ink text-background border-ink"
                : "bg-transparent text-ink-2 border-rule hover:border-ink-3 hover:text-ink"
              }
            `}
          >
            {(r === "CN" || r === "US") && <RegionFlag code={r} />}
            {r === "ALL" ? t("regionAll") : t(`region${r}`)}
          </button>
        );
      })}
    </div>
  );

  const DateRangePicker = ({ isMobile = false }: { isMobile?: boolean }) => (
    <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
      <PopoverTrigger asChild>
        {isMobile ? (
          <Button variant="outline" className="w-full justify-start text-left font-normal">
            <CalendarDays className="w-4 h-4 mr-2 text-muted-foreground" />
            <span className={hasDateFilter ? "" : "text-muted-foreground"}>{dateLabel}</span>
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className={`h-8 text-xs gap-1.5 ${hasDateFilter ? "text-ink font-semibold" : "text-ink-2"}`}
          >
            <CalendarDays className="w-3.5 h-3.5" />
            {dateLabel}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          selected={rdpRange}
          onSelect={handleRdpSelect}
          numberOfMonths={1}
          disabled={{ after: new Date() }}
        />
        {hasDateFilter && (
          <div className="border-t px-3 py-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full h-7 text-xs"
              onClick={() => {
                onDateRangeChange({});
                setCalendarOpen(false);
              }}
            >
              <X className="w-3 h-3 mr-1" />
              {t("resetDate")}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );

  const FilterContent = ({ isMobile = false }: { isMobile?: boolean }) => (
    <div className={`space-y-4 ${isMobile ? "mt-4" : ""}`}>
      <div className="space-y-2">
        <label className="text-sm font-medium">{t("search") || "Search"}</label>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground w-4 h-4" aria-hidden="true" />
          <Input
            type="text"
            aria-label={t("searchLabel")}
            placeholder={t("searchPlaceholder")}
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>
      <div className="space-y-2">
        <label className="text-sm font-medium">{t("dateRange")}</label>
        <DateRangePicker isMobile />
      </div>
      {showRegion && (
        <div className="space-y-2">
          <label className="text-sm font-medium">{t("region")}</label>
          {renderRegionChips(true)}
        </div>
      )}
      <div className="space-y-2">
        <label className="text-sm font-medium">{t("category")}</label>
        <CategoryChips />
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
      <div className="flex items-center gap-2 border-y border-rule py-1.5">
        {/* Desktop Search */}
        <div className="hidden md:block relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 w-4 h-4" aria-hidden="true" />
          <Input
            type="text"
            aria-label={t("searchLabel")}
            placeholder={t("searchPlaceholder")}
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            className="pl-10 border-0 bg-transparent shadow-none focus-visible:ring-2 focus-visible:ring-ring/40 placeholder:text-ink-3"
          />
        </div>

        {/* Mobile Filter */}
        <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
          <SheetTrigger asChild className="md:hidden">
            <Button variant="ghost" className="flex-1 text-ink-2">
              <SlidersHorizontal className="w-4 h-4 mr-2" />
              {t("filters") || "Filters"}
              {hasActiveFilter && (
                <span className="ml-2 w-1.5 h-1.5 bg-jade rounded-full" aria-hidden="true" />
              )}
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[300px]" closeLabel={tc("close")}>
            <SheetHeader>
              <SheetTitle>{t("filters") || "Filters"}</SheetTitle>
            </SheetHeader>
            <FilterContent isMobile />
          </SheetContent>
        </Sheet>

        {/* Desktop Filters */}
        <div className="hidden md:flex items-center gap-2">
          <div className="w-px h-5 bg-rule" />

          <DateRangePicker />

          {hasActiveFilter && (
            <Button variant="ghost" size="sm" className="h-7 text-xs text-ink-2" onClick={handleReset}>
              <X className="w-3 h-3 mr-1" />
              {t("reset")}
            </Button>
          )}
        </div>

        <div className="w-px h-5 bg-rule" />

        {/* View Toggle */}
        <div className="flex items-center rounded-lg p-0.5" role="group">
          <Button
            variant={viewMode === "grid" ? "secondary" : "ghost"}
            size="icon"
            className="h-7 w-7"
            onClick={() => onViewModeChange("grid")}
            aria-label={t("gridView")}
            aria-pressed={viewMode === "grid"}
            title={t("gridView")}
          >
            <Grid3X3 className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
          <Button
            variant={viewMode === "list" ? "secondary" : "ghost"}
            size="icon"
            className="h-7 w-7"
            onClick={() => onViewModeChange("list")}
            aria-label={t("listView")}
            aria-pressed={viewMode === "list"}
            title={t("listView")}
          >
            <List className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        </div>
      </div>

      {/* Desktop Region + Category Chips */}
      <div className="hidden md:flex items-center gap-2 px-1">
        {showRegion && (
          <>
            {renderRegionChips()}
            <div className="w-px h-5 bg-rule" aria-hidden="true" />
          </>
        )}
        <CategoryChips />
        {selectedCategories.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-ink-2"
            onClick={() => onCategoriesChange([])}
            aria-label={`${t("reset")} (${selectedCategories.length})`}
          >
            <X className="w-3 h-3 mr-0.5" aria-hidden="true" />
            {selectedCategories.length}
          </Button>
        )}
      </div>

      {/* Count */}
      <div className="flex items-center justify-between px-1">
        <span className="text-xs text-ink-3">
          {t("totalCount", { count: totalCount })}
        </span>
      </div>
    </div>
  );
}
