"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import type { DayFlow } from "@/lib/today";
import { getSourceName, formatDateGroup } from "@/lib/news-utils";
import { ChartCanvas, baseOptions, hatchPattern } from "@/components/charts/chart-canvas";

/**
 * "오늘" 홈의 오늘의 흐름 (Chart.js — 시안 https://claude.ai/artifact/KbqYXrcAtDGiChEomiXQRw 2·3장):
 *  - 어느 나라 이야기인가: 도넛, 가운데 큰 %(서울의 하루 원형 게이지), 조각에 마우스를 올리면 그 지역으로
 *  - 어느 매체가 썼나: 가로 막대, 왼쪽에서 차례로 차오름 (barFill)
 *  - 최근 7일 기사량: 세로 막대, 하루씩 차례로, 수집이 덜 된 날은 빗금
 * 데이터는 서버(fetchDayFlow, 통계·주간 리포트와 같은 metrics 함수). 수치는 텍스트 범례로도 보인다.
 */
const EASE = "easeOutQuart" as const;

export function TodayFlow({ flow }: { flow: DayFlow }) {
  const t = useTranslations("today");
  const ts = useTranslations("statistics");
  const locale = useLocale();
  const nf = useMemo(() => new Intl.NumberFormat(locale === "zh" ? "zh-CN" : locale === "en" ? "en-US" : "ko-KR"), [locale]);

  const regions = [
    { key: "US", label: ts("regionUS"), value: flow.region.US, color: "us" as const },
    { key: "CN", label: ts("regionCN"), value: flow.region.CN, color: "cn" as const },
    { key: "OTHER", label: ts("regionOTHER"), value: flow.region.OTHER, color: "other" as const },
  ];
  const classified = regions.reduce((a, r) => a + r.value, 0);
  const pct = (v: number) => (classified ? Math.round((v / classified) * 100) : 0);
  const top = regions.reduce((a, r) => (r.value > a.value ? r : a), regions[0]);
  const [focus, setFocus] = useState(top.key);
  const f = regions.find((r) => r.key === focus) ?? top;

  const weekday = useMemo(
    () => new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : locale === "en" ? "en-US" : "ko-KR", { weekday: "short", timeZone: "UTC" }),
    [locale]
  );
  const dayLabel = (d: string) => weekday.format(new Date(`${d}T00:00:00Z`));
  const weekTotal = flow.week.reduce((a, d) => a + d.count, 0);
  const key = `${flow.day}-${flow.total}`;

  const regionLabel = regions.map((r) => `${r.label} ${r.value}`).join(", ");
  const sourceLabel = flow.sources.map((s) => `${getSourceName(s.name)} ${s.value}`).join(", ");
  const weekLabel = flow.week.map((d) => `${d.date} ${d.count}${d.incomplete ? ` (${t("incomplete")})` : ""}`).join(", ");

  return (
    <section aria-labelledby="today-flow-h" className="space-y-4" data-testid="today-flow">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b-2 border-ink pb-2.5">
        <h2 id="today-flow-h" className="text-[22px] font-[800] tracking-[-0.02em] text-ink">
          {t("flowTitle")}
        </h2>
        <span className="font-mono text-[13px] text-ink-3">{t("flowMeta", { date: formatDateGroup(flow.day, locale), total: nf.format(flow.total) })}</span>
      </div>

      {/* grid-cols-1 + min-w-0: 열 정의가 없으면 차트 캔버스 기본 폭(300px)이 칸을 밀어 320px 화면에서 가로로 넘쳤다 (QA E-02) */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3 [&>*]:min-w-0">
        {/* 지역 */}
        <div className="rounded-md border border-rule bg-background p-5">
          <h3 className="mb-3 font-mono text-xs font-semibold text-ink-3">{t("regionTitle")}</h3>
          <div className="relative mx-auto aspect-square w-full max-w-[220px]">
            <ChartCanvas
              className="h-full w-full"
              label={`${t("regionTitle")}: ${regionLabel}`}
              dataKey={key}
              build={(th) => ({
                type: "doughnut",
                data: {
                  labels: regions.map((r) => r.label),
                  datasets: [{ data: regions.map((r) => r.value), backgroundColor: regions.map((r) => th[r.color]), borderWidth: 0, spacing: 2, hoverOffset: 6 }],
                },
                options: {
                  ...baseOptions(th),
                  cutout: "76%",
                  animation: th.reduced ? false : { animateRotate: true, duration: 1100, easing: EASE },
                  onHover: (_e, els) => {
                    if (els.length) setFocus(regions[els[0].index].key);
                  },
                  plugins: { ...baseOptions(th).plugins, tooltip: { callbacks: { label: (c) => ` ${c.label} ${c.raw}` } } },
                },
              })}
            />
            <div className="pointer-events-none absolute inset-0 grid place-items-center text-center" aria-hidden="true">
              <div>
                <p className="text-[44px] font-[300] leading-none tracking-[-0.04em] text-ink tabular-nums">
                  {pct(f.value)}
                  <span className="text-base">%</span>
                </p>
                <p className="mt-1 text-xs text-ink-3">
                  {f.label} · {t("count", { count: f.value })}
                </p>
              </div>
            </div>
          </div>
          <ul className="mt-4 space-y-1.5 text-[13.5px]">
            {regions.map((r) => (
              <li key={r.key}>
                <button
                  type="button"
                  onClick={() => setFocus(r.key)}
                  aria-pressed={focus === r.key}
                  className="flex min-h-8 w-full items-center justify-between rounded-sm px-1 text-left hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex items-center gap-2 text-ink">
                    <span aria-hidden="true" className="h-2.5 w-2.5 rounded-[2px]" style={{ background: `var(--chart-${r.color})` }} />
                    {r.label}
                  </span>
                  <span className="font-mono text-ink-2 tabular-nums">
                    {r.value} · {pct(r.value)}%
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* 매체 */}
        <div className="rounded-md border border-rule bg-background p-5">
          <h3 className="mb-3 font-mono text-xs font-semibold text-ink-3">{t("sourcesTitle")}</h3>
          <ChartCanvas
            className="h-[260px]"
            label={`${t("sourcesTitle")}: ${sourceLabel}`}
            dataKey={key}
            build={(th) => ({
              type: "bar",
              data: {
                labels: flow.sources.map((s) => getSourceName(s.name)),
                datasets: [{ data: flow.sources.map((s) => s.value), backgroundColor: th.ink, borderRadius: 5, borderSkipped: false, maxBarThickness: 20 }],
              },
              options: {
                ...baseOptions(th),
                indexAxis: "y",
                animation: th.reduced ? false : { duration: 1100, easing: EASE, delay: (c) => (c.type === "data" ? c.dataIndex * 90 : 0) },
                scales: { x: { grid: { color: th.rule }, ticks: { color: th.ink3, precision: 0 } }, y: { grid: { display: false }, ticks: { color: th.ink, font: { size: 13 } } } },
                plugins: { ...baseOptions(th).plugins, tooltip: { callbacks: { label: (c) => ` ${t("count", { count: Number(c.raw) })}` } } },
              },
            })}
          />
        </div>

        {/* 최근 7일 */}
        <div className="rounded-md border border-rule bg-background p-5">
          <h3 className="mb-3 font-mono text-xs font-semibold text-ink-3">{t("weekTitle")}</h3>
          <ChartCanvas
            className="h-[220px]"
            label={`${t("weekTitle")}: ${weekLabel}`}
            dataKey={key}
            build={(th) => ({
                // 주간 리포트(DailyColumns)와 같은 규칙: 수집 미완 날은 실제 건수 높이 + 빗금, 기대치는 가로 선
                type: "bar",
                data: {
                  labels: flow.week.map((d) => dayLabel(d.date)),
                  datasets: [
                    {
                      data: flow.week.map((d) => d.count),
                      backgroundColor: flow.week.map((d, i) => (d.incomplete ? hatchPattern(th.ink3) : i === flow.week.length - 1 ? th.jade : th.ink)),
                      borderColor: flow.week.map((d) => (d.incomplete ? th.ink3 : "transparent")),
                      borderWidth: flow.week.map((d) => (d.incomplete ? 1 : 0)),
                      borderRadius: 3,
                      maxBarThickness: 28,
                      order: 2,
                    },
                    {
                      type: "line",
                      data: flow.week.map((d) => d.expected),
                      showLine: false,
                      pointStyle: "line",
                      pointRadius: 13,
                      pointHoverRadius: 13,
                      pointBorderWidth: 2,
                      pointBorderColor: th.amber,
                      order: 1,
                    },
                  ],
                },
                options: {
                  ...baseOptions(th),
                  animation: th.reduced ? false : { duration: 900, easing: EASE, delay: (c) => (c.type === "data" ? c.dataIndex * 110 : 0) },
                  scales: { y: { beginAtZero: true, grid: { color: th.rule }, ticks: { color: th.ink3, precision: 0 } }, x: { grid: { display: false }, ticks: { color: th.ink } } },
                  plugins: {
                    ...baseOptions(th).plugins,
                    tooltip: {
                      callbacks: {
                        title: (i) => flow.week[i[0].dataIndex].date,
                        label: (c) => {
                          const d = flow.week[c.dataIndex];
                          if (c.datasetIndex === 1) return d.expected != null ? ` ${t("expected", { count: d.expected })}` : "";
                          return d.incomplete ? ` ${t("incomplete")} · ${t("count", { count: d.count })}` : ` ${t("count", { count: d.count })}`;
                        },
                      },
                    },
                  },
                },
              })}
          />
          <p className="mt-3 text-[12.5px] leading-relaxed text-ink-3">
            {t("weekNote", { total: nf.format(weekTotal) })}
            {flow.week.some((d) => d.incomplete) && <> · {t("weekHatch")}</>}
          </p>
        </div>
      </div>
    </section>
  );
}
