"use client";

import type { ScriptableContext } from "chart.js";
import { ChartCanvas, baseOptions, withAlpha, type ChartTheme } from "./chart-canvas";

/**
 * 관리자 통계용 Chart.js 기본 차트 (2026-11-03 Recharts → Chart.js 이전, 결정 A).
 * 같은 모양은 같은 부품: 가로·세로 막대 = StatBars, 도넛 = StatDonut, 면적 = StatArea.
 * 색은 테마 토큰. 값 단위 문구(unit: "N건")는 호출자가 번역해서 넘긴다.
 */
type Unit = (n: number) => string;
const EASE = "easeOutQuart" as const;

export interface StatRow {
  name: string;
  value: number;
  /** 지정하지 않으면 테마 글자색(ink) */
  color?: string;
}

export function StatBars({
  rows,
  unit,
  label,
  horizontal = false,
  height = 280,
  color,
}: {
  rows: StatRow[];
  unit: Unit;
  label: string;
  horizontal?: boolean;
  height?: number;
  /** 테마에서 막대 색 고르기 (i = 막대 순번, 기본 jade) */
  color?: (t: ChartTheme, i: number) => string;
}) {
  return (
    <ChartCanvas
      className="w-full"
      label={`${label}: ${rows.map((r) => `${r.name} ${r.value}`).join(", ")}`}
      dataKey={rows.map((r) => `${r.name}:${r.value}`).join("|")}
      build={(th) => ({
        type: "bar",
        data: {
          labels: rows.map((r) => r.name),
          datasets: [
            {
              data: rows.map((r) => r.value),
              backgroundColor: rows.map((r, i) => r.color ?? (color ? color(th, i) : th.jade)),
              borderRadius: 4,
              borderSkipped: horizontal ? "start" : "bottom",
              maxBarThickness: 24,
            },
          ],
        },
        options: {
          ...baseOptions(th),
          indexAxis: horizontal ? "y" : "x",
          animation: th.reduced ? false : { duration: 900, easing: EASE, delay: (c) => (c.type === "data" ? c.dataIndex * 60 : 0) },
          scales: {
            [horizontal ? "x" : "y"]: { beginAtZero: true, grid: { color: th.rule }, ticks: { color: th.ink3, precision: 0 } },
            [horizontal ? "y" : "x"]: { grid: { display: false }, ticks: { color: th.ink2, font: { size: 12 } } },
          },
          plugins: { ...baseOptions(th).plugins, tooltip: { callbacks: { label: (c) => ` ${unit(Number(c.raw))}` } } },
        },
      })}
      style={{ height }}
    />
  );
}

export function StatDonut({ rows, unit, label }: { rows: StatRow[]; unit: Unit; label: string }) {
  const total = rows.reduce((a, r) => a + r.value, 0);
  return (
    <div className="grid items-center gap-4 sm:grid-cols-[200px_1fr]">
      <div className="relative mx-auto aspect-square w-full max-w-[200px]">
        <ChartCanvas
          className="h-full w-full"
          label={`${label}: ${rows.map((r) => `${r.name} ${r.value}`).join(", ")}`}
          dataKey={rows.map((r) => `${r.name}:${r.value}`).join("|")}
          build={(th) => ({
            type: "doughnut",
            data: {
              labels: rows.map((r) => r.name),
              datasets: [{ data: rows.map((r) => r.value), backgroundColor: rows.map((r) => r.color ?? th.ink3), borderWidth: 0, spacing: 2, hoverOffset: 5 }],
            },
            options: {
              ...baseOptions(th),
              cutout: "62%",
              animation: th.reduced ? false : { animateRotate: true, duration: 1000, easing: EASE },
              plugins: { ...baseOptions(th).plugins, tooltip: { callbacks: { label: (c) => ` ${c.label} · ${unit(Number(c.raw))}` } } },
            },
          })}
        />
      </div>
      <ul className="space-y-1.5 text-[13px]">
        {rows.map((r) => (
          <li key={r.name} className="flex items-center justify-between gap-3">
            <span className="flex min-w-0 items-center gap-2 text-ink">
              <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ background: r.color }} />
              <span className="truncate">{r.name}</span>
            </span>
            <span className="shrink-0 font-mono text-ink-2 tabular-nums">
              {r.value} · {total ? Math.round((r.value / total) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function StatArea({ points, unit, label }: { points: { name: string; value: number }[]; unit: Unit; label: string }) {
  return (
    <ChartCanvas
      className="w-full"
      style={{ height: 280 }}
      label={`${label}: ${points.map((p) => `${p.name} ${p.value}`).join(", ")}`}
      dataKey={points.map((p) => `${p.name}:${p.value}`).join("|")}
      build={(th) => ({
        type: "line",
        data: {
          labels: points.map((p) => p.name),
          datasets: [
            {
              data: points.map((p) => p.value),
              borderColor: th.jade,
              borderWidth: 2,
              pointRadius: 0,
              pointHoverRadius: 4,
              cubicInterpolationMode: "monotone",
              fill: true,
              backgroundColor: (ctx: ScriptableContext<"line">) => {
                const { chart } = ctx;
                const area = chart.chartArea;
                if (!area) return "transparent";
                const g = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
                g.addColorStop(0, withAlpha(th.jade, 0.3));
                g.addColorStop(1, withAlpha(th.jade, 0));
                return g;
              },
            },
          ],
        },
        options: {
          ...baseOptions(th),
          interaction: { mode: "index", intersect: false },
          animation: th.reduced ? false : { duration: 1000, easing: EASE },
          scales: {
            y: { beginAtZero: true, grid: { color: th.rule }, ticks: { color: th.ink3, precision: 0 } },
            x: { grid: { display: false }, ticks: { color: th.ink3, maxRotation: 0, autoSkipPadding: 12 } },
          },
          plugins: { ...baseOptions(th).plugins, tooltip: { callbacks: { label: (c) => ` ${unit(Number(c.raw))}` } } },
        },
      })}
    />
  );
}
