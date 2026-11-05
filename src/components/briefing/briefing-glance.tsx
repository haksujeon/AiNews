import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { CardFigure } from "@/lib/briefing/card-spec";
import type { GlanceItem } from "@/lib/briefing/glance";

/*
 * "한눈에 보기" (사용자 결정 2026-11-05, 안 A) — 목차·숫자로 보는 하루·한 장 요약을 한 블록으로.
 * 데스크톱: 한 줄 격자(1번 칸이 조금 넓음). 휴대폰: 옆으로 넘기는 칸.
 * 칸을 누르면 그 기사(#story-N)로 이동만 한다 — 음성은 재생하지 않는다 (사용자 결정).
 * 숫자·그림은 한 장 요약 카드와 같은 명세(card-spec)라 카드 PNG 와 내용이 같다 (Gate 2). 색은 토큰(다크 모드 따라감).
 * items.section 은 호출자가 번역한 분야 이름 (briefing-view 와 서로 import 하지 않게).
 */

function MiniFigure({ fig }: { fig: CardFigure }) {
  if (fig.kind === "bars") {
    const max = Math.max(...fig.items.map((i) => i.value ?? 0)) || 1;
    return (
      <ul className="mt-2 grid gap-1" aria-label={fig.items.map((i) => `${i.label} ${i.raw}`).join(", ")}>
        {fig.items.map((it, i) => (
          <li key={i} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 text-[11.5px] leading-tight text-ink-2">
            <span className="truncate">{it.label}</span>
            <span className="tabular-nums text-ink">{it.raw}</span>
            <span aria-hidden="true" className="col-span-2 block h-1.5 bg-rule">
              <span className={cn("block h-full", i === (fig.emphasis ?? 0) ? "bg-jade" : "bg-ink-3/45")} style={{ width: `${Math.max(3, ((it.value ?? 0) / max) * 100)}%` }} />
            </span>
          </li>
        ))}
      </ul>
    );
  }
  if (fig.kind === "chain") {
    return (
      <ul className="mt-2 grid gap-0.5 text-[11.5px] leading-snug text-ink-2">
        {fig.items.map((it, i) => (
          <li key={i} className="flex min-w-0 gap-1.5">
            <b className="shrink-0 font-semibold tabular-nums text-ink">{it.raw}</b>
            <span className="truncate">{it.label}</span>
          </li>
        ))}
      </ul>
    );
  }
  if (fig.kind === "timeline") {
    return (
      <ol className="mt-2 grid gap-0.5 text-[11.5px] leading-snug text-ink-2">
        {fig.items.map((it, i) => (
          <li key={i} className="flex min-w-0 gap-1.5">
            <b className={cn("shrink-0 font-semibold", i === 0 ? "text-jade" : "text-ink")}>{it.when}</b>
            <span className="truncate">{it.label}</span>
          </li>
        ))}
      </ol>
    );
  }
  return null;
}

export function BriefingGlance({ items, actions, className }: { items: GlanceItem[]; actions?: ReactNode; className?: string }) {
  const t = useTranslations("briefing");
  if (!items.length) return null;
  const cols = `minmax(0,1.35fr) repeat(${Math.max(0, items.length - 1)}, minmax(0,1fr))`;
  return (
    <section aria-labelledby="glance-h" className={cn("min-w-0", className)} data-testid="briefing-glance">
      <div className="flex items-center justify-between gap-x-3 border-b-2 border-rule-strong pb-2">
        <h2 id="glance-h" className="shrink-0 text-[15px] font-bold text-ink">
          {t("glanceTitle")} <span className="ml-1 text-[13px] font-normal text-ink-3 max-sm:hidden">{t("tocTitle", { count: items.length })}</span>
        </h2>
        {actions}
      </div>
      <ol
        className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-2 overflow-x-auto px-4 pb-1 pt-2 [scrollbar-width:none] lg:mx-0 lg:grid lg:snap-none lg:gap-0 lg:overflow-visible lg:px-0 lg:pb-0 lg:pt-0 lg:[grid-template-columns:var(--glance-cols)]"
        style={{ ["--glance-cols" as string]: cols }}
      >
        {items.map((it) => (
          <li key={it.rank} className="w-[78%] max-w-[300px] shrink-0 snap-start border border-rule lg:w-auto lg:max-w-none lg:border-0 lg:border-r lg:last:border-r-0">
            <a
              href={`#story-${it.rank}`}
              className="flex h-full min-h-[132px] flex-col px-3 py-2.5 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring lg:px-3.5 lg:py-3"
              data-testid="glance-item"
            >
              <span className="flex items-baseline gap-2 text-[12px]">
                <span className="text-[16px] font-[800] leading-none text-ink">{it.rank}</span>
                <span className="font-semibold text-jade">{it.section}</span>
              </span>
              <span className="mt-1.5 text-[14px] font-[650] leading-[1.4] text-ink [text-wrap:pretty]">{it.title}</span>
              {it.big && (
                <span className="mt-auto pt-2">
                  <b className="block text-[21px] font-[800] leading-tight tracking-[-0.02em] text-jade tabular-nums">{it.big.raw}</b>
                  <span className="block text-[12px] leading-snug text-ink-3">{it.big.label}</span>
                </span>
              )}
              {it.figure && <MiniFigure fig={it.figure} />}
            </a>
          </li>
        ))}
      </ol>
      {/* 휴대폰: 옆 칸이 살짝 보여 넘길 수 있다는 걸 알린다. 안내 글은 화면 낭독기에만 */}
      <p className="sr-only lg:hidden">{t("glanceSwipe")}</p>
    </section>
  );
}
