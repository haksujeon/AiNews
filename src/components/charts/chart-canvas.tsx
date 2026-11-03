"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import type { Chart, ChartConfiguration, ChartType } from "chart.js";
import { cn } from "@/lib/utils";

/**
 * Chart.js 공용 캔버스 (2026-11-03 결정 A: 상호작용 차트는 Chart.js 하나로 — ~/ainews-reports/home-ui-2026-11/REVIEW.md 5차).
 * 모든 Chart.js 차트가 이 부품을 쓴다 (Gate 2):
 *  - chart.js 는 동적 import, 필요한 컨트롤러만 등록 (막대·선·도넛) — 첫 화면 번들 최소화
 *  - 색은 테마 토큰(globals.css --ink·--rule·--jade·--chart-*)에서 읽고, 테마가 바뀌면(html class) 다시 그린다
 *  - prefers-reduced-motion 이면 애니메이션 없음
 *  - 처음 불러올 때 이미 그려진 상태, 화면을 벗어났다 다시 들어올 때만 다시 재생 (서울의 하루식 장 전환)
 *  - canvas 에 role="img" + aria-label(값 전부), 옆에 텍스트 범례를 두는 것은 호출하는 쪽
 * 정적 리포트 차트(주간·월간)는 서버 SVG(briefing/charts) 그대로 — 클라이언트 JS 없음.
 */
// chart.js 는 차트를 그릴 때 불러온다 (첫 화면 번들에서 빼기 — 약 68KB gzip). 필요한 컨트롤러만 한 번 등록
let loader: Promise<typeof import("chart.js").Chart> | null = null;
function loadChart() {
  loader ??= import("chart.js").then((m) => {
    m.Chart.register(
      m.BarController, m.BarElement, m.LineController, m.LineElement, m.PointElement,
      m.DoughnutController, m.ArcElement, m.CategoryScale, m.LinearScale, m.Tooltip, m.Legend, m.Filler
    );
    return m.Chart;
  });
  return loader;
}

export interface ChartTheme {
  bg: string;
  ink: string;
  ink2: string;
  ink3: string;
  rule: string;
  jade: string;
  cn: string;
  us: string;
  other: string;
  amber: string;
  hatch: string;
  prev: string;
  reduced: boolean;
  font: string;
}

export function readChartTheme(): ChartTheme {
  const s = getComputedStyle(document.documentElement);
  const v = (n: string) => s.getPropertyValue(n).trim();
  return {
    bg: v("--background") || v("--paper"),
    ink: v("--ink"),
    ink2: v("--ink-2"),
    ink3: v("--ink-3"),
    rule: v("--rule"),
    jade: v("--jade"),
    cn: v("--chart-cn"),
    us: v("--chart-us"),
    other: v("--chart-other"),
    amber: v("--chart-amber"),
    hatch: v("--chart-hatch"),
    prev: v("--chart-prev"),
    reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    font: getComputedStyle(document.body).fontFamily,
  };
}

/** 수집 미완 날 등에 쓰는 빗금 무늬 */
export function hatchPattern(color: string): CanvasPattern | string {
  const c = document.createElement("canvas");
  c.width = c.height = 8;
  const x = c.getContext("2d");
  if (!x) return color;
  x.strokeStyle = color;
  x.lineWidth = 2;
  x.beginPath();
  x.moveTo(0, 8);
  x.lineTo(8, 0);
  x.stroke();
  return x.createPattern(c, "repeat") ?? color;
}

/** #rgb·#rrggbb → rgba(). 다른 형식이면 그대로 (canvas 가 color-mix 등을 못 읽을 수 있어 토큰은 16진수로 둔다) */
export function withAlpha(color: string, a: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1];
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** 공통 기본값 — 축 글자·격자 색, 글꼴, 범례 끔(텍스트 범례는 화면에), 반응형 */
export function baseOptions(t: ChartTheme) {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: t.reduced ? (false as const) : undefined,
    font: { family: t.font },
    plugins: { legend: { display: false }, tooltip: { titleFont: { family: t.font }, bodyFont: { family: t.font } } },
  };
}

export function ChartCanvas<T extends ChartType = ChartType>({
  build,
  label,
  dataKey,
  className,
  style,
  onChart,
}: {
  /** 테마를 받아 설정을 만든다 (테마가 바뀌면 다시 부른다) */
  build: (t: ChartTheme) => ChartConfiguration<T>;
  /** 화면 낭독기용 — 값을 모두 담는다 */
  label: string;
  /** 데이터가 바뀌면 바뀌는 키 (다시 그리기) */
  dataKey: string;
  className?: string;
  /** 높이 등 (차트는 부모 높이를 채운다 — maintainAspectRatio:false) */
  style?: CSSProperties;
  onChart?: (chart: Chart | null) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const buildRef = useRef(build);
  const onChartRef = useRef(onChart);
  useEffect(() => {
    buildRef.current = build;
    onChartRef.current = onChart;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let chart: Chart | null = null;
    let ChartCtor: typeof Chart | null = null;
    let dead = false;
    let theme = readChartTheme();
    const make = () => {
      if (!ChartCtor || dead) return;
      chart?.destroy();
      theme = readChartTheme();
      ChartCtor.defaults.color = theme.ink3;
      ChartCtor.defaults.borderColor = theme.rule;
      ChartCtor.defaults.font.family = theme.font;
      chart = new ChartCtor(el, buildRef.current(theme) as unknown as ChartConfiguration);
      onChartRef.current?.(chart);
    };
    loadChart().then((C) => {
      ChartCtor = C;
      make();
    });

    // 테마 전환(next-themes 가 html class 를 바꾼다)·OS 설정 변경 → 토큰을 다시 읽어 다시 그림
    const mo = new MutationObserver(() => make());
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener?.("change", make);

    // 다시 들어올 때만 재생 (처음 들어올 때는 불러올 때 그린 상태 그대로)
    let seen = false;
    let left = false;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e) return;
        if (!e.isIntersecting) {
          if (seen) left = true;
          return;
        }
        seen = true;
        if (left && chart && !theme.reduced) {
          chart.reset();
          chart.update();
        }
        left = false;
      },
      { threshold: 0.3 }
    );
    io.observe(el);

    return () => {
      dead = true;
      io.disconnect();
      mo.disconnect();
      mq.removeEventListener?.("change", make);
      chart?.destroy();
      onChartRef.current?.(null);
    };
  }, [dataKey]);

  return (
    <div className={cn("relative min-w-0", className)} style={style}>
      <canvas ref={ref} role="img" aria-label={label} />
    </div>
  );
}
