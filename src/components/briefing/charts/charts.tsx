import type { ChartIds } from "./chart-figure";
import { HatchDefs } from "./chart-figure";

/*
 * 인라인 SVG 차트 (서버 렌더, 클라이언트 JS 없음). 색은 토큰만: 이번 기간 --chart-1(청자), 비교 기간 --chart-prev(회색),
 * 글자는 글자 색 토큰. 막대 두께 ≤ 24px·끝 4px 둥글게, 이중 축 없음. 클래스(pc-*)는 globals.css.
 * 문구는 호출자가 번역해서 넘긴다 (labels).
 */

const svgProps = (W: number, H: number, ids: ChartIds) => ({
  viewBox: `0 0 ${W} ${H}`,
  width: "100%",
  role: "img" as const,
  "aria-labelledby": ids.titleId,
  "aria-describedby": ids.descId,
  className: "block h-auto w-full overflow-visible",
  preserveAspectRatio: "xMidYMid meet",
});

/** 위가 둥근 세로 막대 path */
function colPath(x: number, y0: number, h: number, bw: number): string {
  if (h <= 0) return "";
  const r = Math.min(4, h, bw / 2);
  return `M${x},${y0} v${-(h - r)} q0,${-r} ${r},${-r} h${bw - 2 * r} q${r},0 ${r},${r} v${h - r} z`;
}

/** 오른쪽이 둥근 가로 막대 path */
function barPath(x0: number, cy: number, w: number, bh: number): string {
  if (w <= 0) return "";
  const r = Math.min(4, w, bh / 2);
  return `M${x0},${cy - bh / 2} h${w - r} q${r},0 ${r},${r} v${bh - 2 * r} q0,${r} ${-r},${r} h${-(w - r)} z`;
}

export interface DayBar {
  day: string;
  count: number;
  incomplete: boolean;
  expected: number;
  /** 축 첫 줄 (요일) */
  label: string;
  /** 축 둘째 줄 (일) */
  sub: string;
  /** 툴팁 */
  tip: string;
  /** 결손일이어도 기대치 선·"수집 미완" 주석을 그리지 않는다 (축소 수집일이 여러 날 이어질 때 — 범례가 설명) */
  quiet?: boolean;
}

/** 요일별 기사 수: 이번 기간(청자) 대 비교 기간(회색), 수집 미완 날은 빗금 + 기대치 선 + 주석 */
export function DailyColumns({
  W,
  ids,
  cur,
  prev,
  gapLabel,
}: {
  W: number;
  ids: ChartIds;
  cur: DayBar[];
  prev: { count: number; tip: string }[] | null;
  gapLabel: string;
}) {
  const H = W < 480 ? 200 : 210;
  const L = 34,
    R = 8,
    T = 18,
    B = 34;
  const n = cur.length;
  const max = Math.max(1, ...cur.map((d) => Math.max(d.count, d.expected)), ...(prev ?? []).map((d) => d.count));
  const yMax = Math.ceil(max / 40) * 40;
  const band = (W - L - R) / n;
  const bw = Math.min(prev ? 14 : 20, band / (prev ? 2.6 : 1.6));
  const y = (v: number) => T + (H - T - B) * (1 - v / yMax);
  const hatch = `${ids.uid}-hatch`;
  return (
    <svg {...svgProps(W, H, ids)}>
      <HatchDefs id={hatch} />
      {[0, yMax / 2, yMax].map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} className="pc-grid" />
          <text x={L - 6} y={y(t) + 4} className="pc-t-axis" textAnchor="end">
            {t}
          </text>
        </g>
      ))}
      {cur.map((d, i) => {
        const cx = L + band * i + band / 2;
        const x1 = prev ? cx - bw - 1 : cx - bw / 2;
        const last = i === n - 1;
        return (
          <g key={d.day} className="pc-hit">
            {prev && prev[i] && (
              <g>
                <title>{prev[i].tip}</title>
                <path d={colPath(cx + 1, y(0), y(0) - y(prev[i].count), bw)} className="pc-prev" />
              </g>
            )}
            <g>
              <title>{d.tip}</title>
              <rect x={x1 - 3} y={T} width={bw + 6} height={H - T - B} fill="transparent" />
              <path
                d={colPath(x1, y(0), Math.max(d.incomplete ? 1.5 : 0, y(0) - y(d.count)), bw)}
                className={d.incomplete ? "pc-gap" : "pc-cur"}
                fill={d.incomplete ? `url(#${hatch})` : undefined}
              />
            </g>
            {d.incomplete && !d.quiet && (
              <>
                <line x1={cx - bw - 2} x2={cx + bw + 2} y1={y(d.expected)} y2={y(d.expected)} className="pc-exp" />
                <text x={last ? cx + bw + 2 : cx} y={y(d.expected) - 7} className="pc-t-note" textAnchor={last ? "end" : "middle"}>
                  {gapLabel}
                </text>
              </>
            )}
            <text x={cx} y={H - B + 16} className="pc-t-axis" textAnchor="middle">
              {d.label}
            </text>
            <text x={cx} y={H - B + 29} className="pc-t-axis2" textAnchor="middle">
              {d.sub}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export interface DumbbellRow {
  key: string;
  label: string;
  prev: number;
  cur: number;
  /** 증감 표기 (없으면 ▲/▼) */
  chg?: string | null;
  /** 中 표식 (중국 기업·기관) */
  cn?: boolean;
  pinyin?: string;
  tip: string;
}

/** 덤벨: 비교 기간(회색 점) → 이번 기간(청자 점). 값과 증감을 직접 표기 */
export function Dumbbell({
  W,
  ids,
  rows,
  pinyin = false,
  cnMark,
  unit = "",
  step = 20,
}: {
  W: number;
  ids: ChartIds;
  rows: DumbbellRow[];
  pinyin?: boolean;
  cnMark?: string;
  unit?: string;
  step?: number;
}) {
  const narrow = W < 480;
  const leftW = pinyin ? (narrow ? 128 : 168) : narrow ? 100 : 118;
  const R = narrow ? 96 : 108;
  const rowH = pinyin ? 36 : 28;
  const T = 8;
  const H = T + rows.length * rowH + 22;
  const max = Math.max(1, ...rows.flatMap((r) => [r.prev, r.cur]));
  const xMax = Math.ceil(max / step) * step;
  const x = (v: number) => leftW + (W - leftW - R) * (v / xMax);
  return (
    <svg {...svgProps(W, H, ids)}>
      {[0, xMax / 2, xMax].map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={T} y2={H - 22} className="pc-grid" />
          <text x={x(t)} y={H - 6} className="pc-t-axis" textAnchor="middle">
            {t}
          </text>
        </g>
      ))}
      {rows.map((r, i) => {
        const cy = T + i * rowH + rowH / 2;
        const up = r.cur >= r.prev;
        return (
          <g key={r.key} className="pc-hit">
            <title>{r.tip}</title>
            <rect x={0} y={cy - rowH / 2} width={W} height={rowH} fill="transparent" />
            {pinyin && r.pinyin && (
              <text x={leftW - 10} y={cy - 6} className="pc-t-py" textAnchor="end">
                {r.pinyin}
              </text>
            )}
            <text
              x={leftW - 10}
              y={cy + (pinyin ? 10 : 4)}
              className={pinyin ? "pc-t-han font-han" : "pc-t-label"}
              textAnchor="end"
              lang={pinyin ? "zh-CN" : undefined}
            >
              {r.label}
              {r.cn && cnMark ? <tspan className="pc-t-cn">{` ${cnMark}`}</tspan> : null}
            </text>
            <line x1={x(r.prev)} x2={x(r.cur)} y1={cy} y2={cy} className="pc-db" />
            <circle cx={x(r.prev)} cy={cy} r={4.5} className="pc-dprev" />
            <circle cx={x(r.cur)} cy={cy} r={5} className="pc-dcur" />
            <text x={W - R + 10} y={cy + 4} className="pc-t-val">
              {`${r.prev}${unit}→${r.cur}${unit}`}
              <tspan className="pc-t-chg">{` ${r.chg ?? (up ? "▲" : "▼")}`}</tspan>
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export interface BarRow {
  key: string;
  label: string;
  cur: number;
  prev: number;
  /** 값 옆 보조 (비중 등) */
  extra?: string;
  chg?: string | null;
  tip: string;
}

/** 가로 막대 + 비교 기간 세로 눈금 (noPrev 면 눈금 없이 막대만 — 비교 기간이 없을 때) */
export function BarsTick({
  W,
  ids,
  rows,
  step = 50,
  noPrev = false,
  unit = "",
}: {
  W: number;
  ids: ChartIds;
  rows: BarRow[];
  step?: number;
  noPrev?: boolean;
  unit?: string;
}) {
  const narrow = W < 480;
  const leftW = narrow ? 84 : 96;
  const R = narrow ? 104 : 120;
  const rowH = 26;
  const T = 6;
  const H = T + rows.length * rowH + 20;
  const max = Math.max(1, ...rows.flatMap((r) => (noPrev ? [r.cur] : [r.cur, r.prev])));
  const xMax = Math.ceil(max / step) * step;
  const x = (v: number) => leftW + (W - leftW - R) * (v / xMax);
  return (
    <svg {...svgProps(W, H, ids)}>
      {[0, xMax / 2, xMax].map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={T} y2={H - 20} className="pc-grid" />
          <text x={x(t)} y={H - 5} className="pc-t-axis" textAnchor="middle">
            {t}
          </text>
        </g>
      ))}
      {rows.map((r, i) => {
        const cy = T + i * rowH + rowH / 2;
        return (
          <g key={r.key} className="pc-hit">
            <title>{r.tip}</title>
            <rect x={0} y={cy - rowH / 2} width={W} height={rowH} fill="transparent" />
            <text x={leftW - 10} y={cy + 4} className="pc-t-label" textAnchor="end">
              {r.label}
            </text>
            <path d={barPath(x(0), cy, x(r.cur) - x(0), 12)} className="pc-cur" />
            {!noPrev && <line x1={x(r.prev)} x2={x(r.prev)} y1={cy - 9} y2={cy + 9} className="pc-tick" />}
            <text x={x(noPrev ? r.cur : Math.max(r.cur, r.prev)) + 8} y={cy + 4} className="pc-t-val">
              {r.cur}
              {unit}
              {r.extra ? ` · ${r.extra}` : ""}
              {r.chg && r.chg !== "—" ? <tspan className="pc-t-chg">{` ${r.chg}`}</tspan> : null}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export interface MultipleSeries {
  key: string;
  label: string;
  cn?: boolean;
  /** 주마다 값 (1천 건당) */
  values: number[];
  tips: string[];
}

/**
 * 작은 여러 개 (월간 기업별 주별 언급, 1천 건당). 모든 칸이 같은 y 축을 쓴다.
 * 축소 수집 주(reduced)는 칸 배경을 빗금으로 깔고 점을 속이 빈 원으로 그린다 — 색에만 기대지 않는다.
 */
export function SmallMultiples({
  W,
  ids,
  series,
  weeks,
  cnMark,
}: {
  W: number;
  ids: ChartIds;
  series: MultipleSeries[];
  weeks: { label: string; reduced: boolean }[];
  cnMark?: string;
}) {
  const cols = W < 480 ? 2 : 3;
  const gap = 14;
  const cw = (W - gap * (cols - 1)) / cols;
  const ch = 96;
  const rowsN = Math.ceil(series.length / cols);
  const H = rowsN * (ch + gap);
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const yMax = Math.ceil(max / 50) * 50;
  const padL = 14,
    padR = 30,
    top = 22,
    bottom = 18;
  const n = weeks.length;
  const hatch = `${ids.uid}-smh`;
  return (
    <svg {...svgProps(W, H, ids)}>
      <HatchDefs id={hatch} />
      {series.map((s, i) => {
        const ox = (i % cols) * (cw + gap);
        const oy = Math.floor(i / cols) * (ch + gap);
        const px = (j: number) => ox + padL + ((cw - padL - padR) * (n === 1 ? 0.5 : j / (n - 1)));
        const py = (v: number) => oy + top + (ch - top - bottom) * (1 - v / yMax);
        const band = (cw - padL - padR) / Math.max(1, n - 1);
        const last = s.values.length - 1;
        return (
          <g key={s.key}>
            <text x={ox} y={oy + 13} className="pc-t-label">
              {s.label}
              {s.cn && cnMark ? <tspan className="pc-t-cn">{` ${cnMark}`}</tspan> : null}
            </text>
            {weeks.map((w, j) =>
              w.reduced ? (
                <rect
                  key={j}
                  x={Math.max(ox, px(j) - band / 2)}
                  y={oy + top}
                  width={Math.min(band, cw - padR)}
                  height={ch - top - bottom}
                  fill={`url(#${hatch})`}
                  opacity={0.55}
                />
              ) : null
            )}
            <line x1={ox + padL} x2={ox + cw - padR} y1={py(0)} y2={py(0)} className="pc-grid" />
            <line x1={ox + padL} x2={ox + cw - padR} y1={py(yMax)} y2={py(yMax)} className="pc-grid" />
            <polyline points={s.values.map((v, j) => `${px(j)},${py(v)}`).join(" ")} fill="none" className="pc-line" />
            {s.values.map((v, j) => (
              <g key={j} className="pc-hit">
                <title>{s.tips[j]}</title>
                <circle cx={px(j)} cy={py(v)} r={weeks[j]?.reduced ? 3.5 : 4} className={weeks[j]?.reduced ? "pc-dprev" : "pc-dcur"} />
              </g>
            ))}
            <text x={px(last) + 7} y={py(s.values[last] ?? 0) + 4} className="pc-t-val">
              {s.values[last] ?? 0}
            </text>
            {weeks.map((w, j) => (
              <text key={j} x={px(j)} y={oy + ch - 3} className="pc-t-axis2" textAnchor="middle">
                {w.label}
              </text>
            ))}
            {i % cols === 0 && (
              <text x={ox + cw - padR + 4} y={py(yMax) + 4} className="pc-t-axis2">
                {yMax}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
