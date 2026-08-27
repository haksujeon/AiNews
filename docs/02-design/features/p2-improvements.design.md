# P2 Improvements Design Document

> **Feature**: Statistics Dashboard + Original Title Toggle
> **Plan Reference**: `docs/01-plan/features/p2-improvements.plan.md`
> **Date**: 2026-02-15
> **Status**: Approved

---

## 1. Component Architecture

```
StatisticsPage (Server Component)
  ├── Header (existing, modified - add nav link)
  ├── StatisticsContainer (Client Component)
  │   ├── StatCards (4x KPI cards)
  │   ├── CategoryChart (Donut - recharts PieChart)
  │   ├── SentimentChart (Donut - recharts PieChart)
  │   ├── CountryChart (Horizontal Bar - recharts BarChart)
  │   └── DailyVolumeChart (Area - recharts AreaChart)
  └── Footer (existing)

NewsDetail (modified)
  └── TitleToggle (inline state toggle for AI translation / original title)
```

## 2. Data Flow

### 2.1 Statistics Page
```
fetchNewsList() → Server Component → pass NewsItem[] as prop
  → StatisticsContainer (client) computes stats via useMemo
    → calculateCategoryStats(news)  → CategoryChart
    → calculateSentimentStats(news) → SentimentChart
    → calculateCountryStats(news)   → CountryChart
    → calculateDailyVolume(news)    → DailyVolumeChart
    → calculateKPIs(news)           → StatCards
```

### 2.2 Original Title Toggle
```
NewsDetail state: showOriginal (boolean, default false)
  → Toggle button group above title
  → If showOriginal: display original_title
  → Else: display getTitle(news, locale) (existing behavior)
  → Only show toggle when original_title exists and differs from displayed title
```

## 3. File Specifications

### 3.1 `src/lib/statistics-utils.ts`

```typescript
// Input: NewsItem[]
// Output types:
interface CategoryStat { name: string; value: number; color: string }
interface SentimentStat { name: string; value: number; color: string }
interface CountryStat { name: string; value: number; label: string }
interface DailyVolume { date: string; count: number }
interface KPIData { totalNews: number; todayNews: number; categoryCount: number; countryCount: number }

export function calculateCategoryStats(news: NewsItem[]): CategoryStat[]
export function calculateSentimentStats(news: NewsItem[]): SentimentStat[]
export function calculateCountryStats(news: NewsItem[]): CountryStat[]
export function calculateDailyVolume(news: NewsItem[]): DailyVolume[]
export function calculateKPIs(news: NewsItem[]): KPIData
```

### 3.2 Chart Components (all "use client" with recharts)

| Component | Recharts Components | Size |
|-----------|-------------------|------|
| CategoryChart | PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer | Card wrapper |
| SentimentChart | PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer | Card wrapper |
| CountryChart | BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer | Card wrapper |
| DailyVolumeChart | AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer | Card wrapper |

### 3.3 Layout Grid
```
Desktop (lg+):  4-col KPI cards, then 2x2 chart grid
Tablet (md):    2-col KPI cards, then 1-col charts
Mobile (sm):    1-col everything stacked
```

### 3.4 Header Modification
- Add `BarChart3` icon + "Statistics" link between app name and language switcher
- Use `nav` element with flex gap for links

### 3.5 News Detail Toggle
- Two inline buttons: `[AI Translation]` `[Original]`
- Active state: primary bg, inactive: ghost
- Only rendered when `news.original_title` exists
- Positioned above the title `<h1>`

## 4. Recharts Color Mapping

Reuse existing category/sentiment colors from `news-utils.ts`:
- Categories: blue, purple, emerald, amber, cyan, pink, orange (+ gray fallback)
- Sentiments: green (positive), red (negative), gray (neutral)
- Use hex equivalents for recharts fill props

## 5. Translation Keys

### statistics namespace (new)
```
title, totalNews, todayNews, categories, countries,
categoryDistribution, sentimentAnalysis, countryBreakdown, dailyVolume, articles
```

### detail namespace (extend)
```
aiTranslation, originalTitle
```

## 6. Implementation Order

1. `recharts` install
2. `statistics-utils.ts`
3. `stat-cards.tsx` → `category-chart.tsx` → `sentiment-chart.tsx` → `country-chart.tsx` → `daily-volume-chart.tsx`
4. `statistics-container.tsx` → `statistics/page.tsx`
5. `header.tsx` modification
6. `news-detail.tsx` toggle
7. Translation files
8. Build verification
