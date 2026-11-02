import { useId } from "react";
import { cn } from "@/lib/utils";

/*
 * 주간·월간 리포트 차트 틀 (설계 검토서 §5.3 접근성):
 *  - <figure> + 제목(h3) + 결론 한 줄, SVG 는 role="img" + aria-labelledby/aria-describedby
 *  - 데스크톱(640폭)·모바일(360폭) SVG 를 따로 그려 그림 칸 폭(컨테이너 쿼리, 480px 미만이면 모바일)에 따라 하나만 보인다 (display:none 이라 접근성 이름이 두 번 읽히지 않는다).
 *    640 SVG 를 390 화면에 줄이면 글자가 약 6px 이 되는 문제를 막는다.
 *  - <details> 표 대체, 클라이언트 JS 없음.
 */

export interface ChartIds {
  titleId: string;
  descId?: string;
  /** SVG 안 패턴 id 접두 (useId 는 콜론·꺾쇠를 포함할 수 있어 정리한다) */
  uid: string;
}

export type ChartRender = (width: number, ids: ChartIds) => React.ReactNode;

export function ChartFigure({
  title,
  desc,
  render,
  mobileWidth = 360,
  desktopWidth = 640,
  note,
  table,
  tableLabel,
  className,
  testId,
}: {
  title: string;
  desc?: string;
  render: ChartRender;
  desktopWidth?: number;
  mobileWidth?: number;
  note?: React.ReactNode;
  table: React.ReactNode;
  tableLabel: string;
  className?: string;
  testId?: string;
}) {
  const raw = useId();
  const uid = `c${raw.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const ids: ChartIds = { titleId: `${uid}-t`, descId: desc ? `${uid}-d` : undefined, uid };
  return (
    <figure className={cn("@container m-0 min-w-0 border-b border-rule pb-3.5 pt-[18px]", className)} aria-labelledby={ids.titleId} data-testid={testId}>
      <figcaption>
        <h3 id={ids.titleId} className="text-[15.5px] font-bold text-ink">
          {title}
        </h3>
        {desc && (
          <p id={ids.descId} className="mt-0.5 text-[13.5px] leading-[1.55] text-ink-2">
            {desc}
          </p>
        )}
      </figcaption>
      {/* 원래 폭의 1.25배까지만 키운다 (1단으로 접힌 420폭 차트의 글자가 과하게 커지지 않게) */}
      <div className="pc-only-d mt-2.5" style={{ maxWidth: Math.round(desktopWidth * 1.25) }}>
        {render(desktopWidth, ids)}
      </div>
      <div className="pc-only-m mt-2.5" style={{ maxWidth: Math.round(mobileWidth * 1.25) }}>
        {render(mobileWidth, { ...ids, uid: `${uid}m` })}
      </div>
      {note && <p className="mt-1.5 text-[12.5px] leading-[1.55] text-ink-3">{note}</p>}
      <details className="mt-1.5 text-[13px]" data-testid="chart-table">
        <summary className="flex min-h-8 cursor-pointer items-center rounded-sm text-ink-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {tableLabel}
        </summary>
        <div className="overflow-x-auto">{table}</div>
      </details>
    </figure>
  );
}

export function DataTable({ head, rows, caption }: { head: string[]; rows: (string | number)[][]; caption?: string }) {
  return (
    <table className="w-full border-collapse text-[13px]">
      {caption && <caption className="sr-only">{caption}</caption>}
      <thead>
        <tr>
          {head.map((h) => (
            <th key={h} scope="col" className="border-t border-rule py-1.5 pr-2 text-left font-semibold text-ink-3">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {r.map((c, j) =>
              j === 0 ? (
                <th key={j} scope="row" className="border-t border-rule py-1.5 pr-2 text-left font-normal text-ink">
                  {c}
                </th>
              ) : (
                <td key={j} className="border-t border-rule py-1.5 pr-2 text-ink-2">
                  {c}
                </td>
              )
            )}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** SVG 정의: 수집 미완 빗금 */
export function HatchDefs({ id }: { id: string }) {
  return (
    <defs>
      <pattern id={id} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="5" height="5" className="pc-hatch-bg" />
        <line x1="0" y1="0" x2="0" y2="5" className="pc-hatch-line" />
      </pattern>
    </defs>
  );
}
