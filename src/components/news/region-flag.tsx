import { cn } from "@/lib/utils";

/**
 * 작은 국기 (2026-11-03 사용자 요청: 미국/중국 구분을 국기로 — 가시성).
 * 이모지 국기는 Windows 에서 "CN" 글자로 보여서 인라인 SVG 로 그린다. 글자 라벨과 함께 쓰는 장식이라 aria-hidden.
 * 대만·홍콩은 대표 지역이 중국으로 정규화된다 (결정 2026-11-02) — 따로 그리지 않는다.
 */
export type FlagCode = "CN" | "US" | "KR" | "JP" | "EU";

const FLAG_CODES = new Set<string>(["CN", "US", "KR", "JP", "EU"]);

export function hasFlag(code: string | null | undefined): code is FlagCode {
  return !!code && FLAG_CODES.has(code);
}

function star(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 === 0 ? r : r * 0.4;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(" ");
}

function FlagBody({ code }: { code: FlagCode }) {
  switch (code) {
    case "CN":
      return (
        <>
          <rect width="30" height="20" fill="#DE2910" />
          <polygon points={star(5, 5, 3)} fill="#FFDE00" />
          {[
            [10, 2],
            [12, 4],
            [12, 7],
            [10, 9],
          ].map(([x, y]) => (
            <polygon key={`${x}-${y}`} points={star(x, y, 1)} fill="#FFDE00" />
          ))}
        </>
      );
    case "US":
      return (
        <>
          <rect width="30" height="20" fill="#FFFFFF" />
          {Array.from({ length: 7 }, (_, i) => (
            <rect key={i} y={(i * 20) / 6.5} width="30" height={20 / 13} fill="#B22234" />
          ))}
          <rect width="13" height={(20 * 7) / 13} fill="#3C3B6E" />
        </>
      );
    case "KR":
      return (
        <>
          <rect width="30" height="20" fill="#FFFFFF" />
          <path d="M10 10a5 5 0 0 1 10 0z" fill="#CD2E3A" />
          <path d="M10 10a5 5 0 0 0 10 0z" fill="#0047A0" />
          <g stroke="#000" strokeWidth="1.1">
            <path d="M4.5 4.5l2.5-2M4 7l2.5-2.2M25.5 15.5l-2.5 2M26 13l-2.5 2.2M4.5 15.5l2.5 2M4 13l2.5 2.2M25.5 4.5l-2.5-2M26 7l-2.5-2.2" />
          </g>
        </>
      );
    case "JP":
      return (
        <>
          <rect width="30" height="20" fill="#FFFFFF" />
          <circle cx="15" cy="10" r="6" fill="#BC002D" />
        </>
      );
    case "EU":
      return (
        <>
          <rect width="30" height="20" fill="#003399" />
          {Array.from({ length: 12 }, (_, i) => {
            const a = (i * Math.PI) / 6;
            return <circle key={i} cx={(15 + 6 * Math.cos(a)).toFixed(2)} cy={(10 + 6 * Math.sin(a)).toFixed(2)} r="0.9" fill="#FFCC00" />;
          })}
        </>
      );
  }
}

/** 16×11 국기. 흰 바탕 국기도 보이게 괘선 테두리 */
export function RegionFlag({ code, className }: { code: string | null | undefined; className?: string }) {
  if (!hasFlag(code)) return null;
  return (
    <svg
      viewBox="0 0 30 20"
      width="16"
      height="11"
      aria-hidden="true"
      focusable="false"
      data-testid="region-flag"
      data-flag={code}
      className={cn("inline-block shrink-0 rounded-[1px] ring-1 ring-rule align-[-1px]", className)}
    >
      <FlagBody code={code} />
    </svg>
  );
}
