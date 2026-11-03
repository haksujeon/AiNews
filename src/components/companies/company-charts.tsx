"use client";

import { useState } from "react";
import type { ScriptableContext } from "chart.js";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { ChartCanvas, baseOptions, withAlpha } from "@/components/charts/chart-canvas";

/**
 * 기업·이슈 차트 (Chart.js — 시안 https://claude.ai/artifact/KbqYXrcAtDGiChEomiXQRw 4·7·8장). 모두 ChartCanvas 를 쓴다.
 *  - CompanyBars: 많이 다뤄진 기업, 가로 막대 두 벌(최근 7일 진하게·그 전 7일 옅게), 전체/중국/해외 칩 → 재정렬, 막대 누르면 기업 페이지
 *  - CompanyTrend: 주별 100건당 언급, 수집 미완 주는 점선 구간, 선이 왼쪽부터 그려짐
 *  - CoBars: 함께 언급된 기업, 위에서부터 차례로, 누르면 그 기업 페이지
 */
const EASE = "easeOutQuart" as const;

export interface BarRow {
  key: string;
  name: string;
  chinese: boolean;
  cur: number;
  prev: number;
}

type Filter = "all" | "cn" | "overseas";

export function CompanyBars({ rows, limit = 12 }: { rows: BarRow[]; limit?: number }) {
  const t = useTranslations("companies");
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const shown = rows
    .filter((r) => (filter === "all" ? true : filter === "cn" ? r.chinese : !r.chinese))
    .sort((a, b) => b.cur - a.cur || b.prev - a.prev)
    .slice(0, limit);
  const label = `${t("topTitle")}: ${shown.map((r) => `${r.name} ${r.cur} (${r.prev})`).join(", ")}`;

  return (
    <div>
      <div role="group" aria-label={t("topTitle")} className="mb-3 flex flex-wrap gap-1.5">
        {(["all", "cn", "overseas"] as const).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={cn(
              "min-h-9 rounded-full border px-3.5 text-[13px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              filter === f ? "border-ink bg-ink text-background" : "border-rule text-ink-2 hover:border-ink-3"
            )}
          >
            {t(f === "all" ? "filterAll" : f === "cn" ? "filterCN" : "filterOverseas")}
          </button>
        ))}
      </div>
      <div className="mb-2 flex gap-4 text-[12.5px] text-ink-3" aria-hidden="true">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[2px] bg-ink" />
          <span className="-ml-1 h-2.5 w-2.5 rounded-[2px] bg-[var(--chart-cn)]" />
          {t("thisWeek")} ({t("filterCN")} = <span className="text-[var(--chart-cn)]">■</span>)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[2px] bg-ink/25" />
          {t("lastWeek")}
        </span>
      </div>
      <ChartCanvas
        style={{ height: Math.max(160, shown.length * 34 + 40) }}
        label={label}
        dataKey={`${filter}:${shown.map((r) => r.key).join(",")}`}
        build={(th) => ({
          type: "bar",
          data: {
            labels: shown.map((r) => r.name),
            datasets: [
              { label: t("thisWeek"), data: shown.map((r) => r.cur), backgroundColor: shown.map((r) => (r.chinese ? th.cn : th.ink)), borderRadius: 4, borderSkipped: "start", barPercentage: 0.9, categoryPercentage: 0.78 },
              { label: t("lastWeek"), data: shown.map((r) => r.prev), backgroundColor: withAlpha(th.ink3, 0.3), borderRadius: 4, borderSkipped: "start", barPercentage: 0.9, categoryPercentage: 0.78 },
            ],
          },
          options: {
            ...baseOptions(th),
            indexAxis: "y",
            animation: th.reduced ? false : { duration: 1000, easing: EASE, delay: (c) => (c.type === "data" ? c.dataIndex * 70 : 0) },
            scales: {
              x: { beginAtZero: true, grid: { color: th.rule }, ticks: { color: th.ink3, precision: 0 } },
              y: { grid: { display: false }, ticks: { color: th.ink, font: { size: 13 } } },
            },
            onClick: (_e, els) => {
              const r = els.length ? shown[els[0].index] : null;
              if (r) router.push(`/companies/${r.key}`);
            },
            onHover: (e, els) => {
              const c = e.native?.target as HTMLElement | undefined;
              if (c) c.style.cursor = els.length ? "pointer" : "default";
            },
            plugins: { ...baseOptions(th).plugins, tooltip: { callbacks: { label: (c) => ` ${c.dataset.label} ${c.raw}` } } },
          },
        })}
      />
    </div>
  );
}

export interface TrendPoint {
  label: string;
  /** 기사 100건당 언급 (소수 1자리) */
  value: number;
  count: number;
  total: number;
  incomplete: boolean;
}

export function CompanyTrend({ points, name }: { points: TrendPoint[]; name: string }) {
  const t = useTranslations("companies");
  const label = `${t("trendTitle")} — ${name}: ${points.map((p) => `${p.label} ${p.value}${p.incomplete ? "*" : ""}`).join(", ")}`;
  return (
    <ChartCanvas<"line">
      style={{ height: 240 }}
      label={label}
      dataKey={points.map((p) => `${p.label}:${p.value}`).join("|")}
      build={(th) => {
        const n = points.length;
        const step = th.reduced ? 0 : 1100 / Math.max(1, n);
        return {
          type: "line",
          data: {
            labels: points.map((p) => p.label),
            datasets: [
              {
                data: points.map((p) => p.value),
                borderColor: th.jade,
                borderWidth: 2.5,
                cubicInterpolationMode: "monotone",
                pointRadius: points.map((p) => (p.incomplete ? 3 : 4)),
                pointBackgroundColor: points.map((p) => (p.incomplete ? th.bg : th.jade)),
                pointBorderColor: th.jade,
                pointBorderWidth: 2,
                // 수집 미완 주에 닿는 구간은 점선 (비교 주의)
                segment: { borderDash: (c) => (points[c.p0DataIndex]?.incomplete || points[c.p1DataIndex]?.incomplete ? [5, 4] : undefined) },
                fill: true,
                backgroundColor: (ctx: ScriptableContext<"line">) => {
                  const area = ctx.chart.chartArea;
                  if (!area) return "transparent";
                  const g = ctx.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
                  g.addColorStop(0, withAlpha(th.jade, 0.22));
                  g.addColorStop(1, withAlpha(th.jade, 0));
                  return g;
                },
              },
            ],
          },
          options: {
            ...baseOptions(th),
            interaction: { mode: "index", intersect: false },
            // 선이 왼쪽부터 그려짐 (Chart.js "Progressive line" 예제)
            animation: th.reduced ? false : undefined,
            animations: th.reduced
              ? {}
              : {
                  x: { type: "number", easing: "linear", duration: step, from: NaN, delay: (c: ScriptableContext<"line">) => (c.type === "data" ? c.dataIndex * step : 0) },
                  y: {
                    type: "number",
                    easing: "linear",
                    duration: step,
                    from: (c: ScriptableContext<"line">) =>
                      c.dataIndex === 0 ? c.chart.scales.y.getPixelForValue(0) : c.chart.getDatasetMeta(0).data[c.dataIndex - 1]?.getProps(["y"], true).y,
                    delay: (c: ScriptableContext<"line">) => (c.type === "data" ? c.dataIndex * step : 0),
                  },
                },
            scales: {
              y: { beginAtZero: true, grid: { color: th.rule }, ticks: { color: th.ink3 } },
              x: { grid: { display: false }, ticks: { color: th.ink3, maxRotation: 0, autoSkipPadding: 10 } },
            },
            plugins: {
              ...baseOptions(th).plugins,
              tooltip: {
                callbacks: {
                  label: (c) => {
                    const p = points[c.dataIndex];
                    return ` ${t("per100", { value: p.value })} (${p.count}/${p.total})${p.incomplete ? " *" : ""}`;
                  },
                },
              },
            },
          },
        };
      }}
    />
  );
}

export function CoBars({ rows }: { rows: { key: string; name: string; n: number; chinese: boolean }[] }) {
  const t = useTranslations("companies");
  const router = useRouter();
  return (
    <ChartCanvas
      style={{ height: Math.max(140, rows.length * 32 + 30) }}
      label={`${t("coTitle")}: ${rows.map((r) => `${r.name} ${r.n}`).join(", ")}`}
      dataKey={rows.map((r) => `${r.key}:${r.n}`).join("|")}
      build={(th) => ({
        type: "bar",
        data: {
          labels: rows.map((r) => r.name),
          datasets: [{ data: rows.map((r) => r.n), backgroundColor: rows.map((r) => (r.chinese ? th.cn : th.ink)), borderRadius: 4, borderSkipped: "start", maxBarThickness: 18 }],
        },
        options: {
          ...baseOptions(th),
          indexAxis: "y",
          animation: th.reduced ? false : { duration: 900, easing: EASE, delay: (c) => (c.type === "data" ? c.dataIndex * 90 : 0) },
          scales: {
            x: { beginAtZero: true, grid: { color: th.rule }, ticks: { color: th.ink3, precision: 0 } },
            y: { grid: { display: false }, ticks: { color: th.ink, font: { size: 13 } } },
          },
          onClick: (_e, els) => {
            const r = els.length ? rows[els[0].index] : null;
            if (r) router.push(`/companies/${r.key}`);
          },
          onHover: (e, els) => {
            const c = e.native?.target as HTMLElement | undefined;
            if (c) c.style.cursor = els.length ? "pointer" : "default";
          },
          plugins: { ...baseOptions(th).plugins, tooltip: { callbacks: { label: (c) => ` ${c.raw}` } } },
        },
      })}
    />
  );
}
