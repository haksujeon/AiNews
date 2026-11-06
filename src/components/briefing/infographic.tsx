import type { ComponentType } from "react";
import { useTranslations } from "next-intl";
import { Bot, CircuitBoard, Coins, Cpu, Factory, FlaskConical, Landmark, Newspaper, Package, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDateGroup } from "@/lib/news-utils";
import type { BigNumber, CardFigure } from "@/lib/briefing/card-spec";
import type { GlanceItem } from "@/lib/briefing/glance";
import type { FxRates } from "@/lib/fx/convert";
import { FxNote } from "@/components/fx/fx-note";

/*
 * 인포그래픽 칸 — 페이지 "한눈에 보기"(데스크톱 칸·휴대폰 줄)와 아침 메일·공유 그림(가로형 PNG)이 같은 부품 (Gate 2).
 * 확정 시안 2026-11-05 (claude.ai artifact 6AeaKgMa…): 칸마다 그래프 하나(막대·숫자 목록·일정·비율 미터·증감),
 * 분야는 아이콘에만 색, 막대는 처음 보일 때 차오름(.glance-grow, 움직임 줄이기면 끔).
 * 색은 사이트 토큰 — 강조 숫자는 언제나 청자, 분야 색(--sec-*)은 아이콘에만.
 * 숫자는 card-spec 이 검사한 것만. 증감·미터는 bigTrend 가 기사 글로 정한다.
 */

/** fx = 큰 숫자가 금액일 때 그 언어 통화 환산 값 ("약 2조 1,400억 원", fx/convert.ts). 페이지만 — 카드 그림은 넘기지 않는다 */
export type GlanceCell = GlanceItem & { sectionLabel: string; outlets?: string; fx?: string | null };

const SECTION_ICON: Record<string, ComponentType<{ className?: string; "aria-hidden"?: boolean }>> = {
  funding: Coins,
  products: Package,
  models: Cpu,
  robotics: Bot,
  industry: Factory,
  research: FlaskConical,
  chips: CircuitBoard,
  policy: Landmark,
  safety: ShieldCheck,
};

export function SectionTag({ code, label, className }: { code: string; label: string; className?: string }) {
  const Icon = SECTION_ICON[code] ?? Newspaper;
  return (
    <span className={cn("inline-flex items-center gap-1 font-semibold", className)} style={{ color: `var(--sec-${code}, var(--jade))` }}>
      <Icon aria-hidden className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

function Triangle({ dir }: { dir: "up" | "down" }) {
  return (
    <svg viewBox="0 0 10 10" aria-hidden="true" className="h-[0.55em] w-[0.55em] fill-current">
      <path d={dir === "up" ? "M5 1l4 6H1z" : "M5 9L1 3h8z"} />
    </svg>
  );
}

/** 큰 숫자 (증감이면 ▲▼ 띠, 크기는 다른 칸 큰 숫자와 같게) */
export function BigValue({ big, className }: { big: BigNumber; className?: string }) {
  const t = useTranslations("briefing");
  // 영어 표기는 길다("about 150 billion yuan") — 14자 넘으면 한 단계 작게 (칸 높이가 들쭉날쭉하지 않게, Gate 3)
  const text = big.raw.length > 14 ? <span className="text-[0.8em]">{big.raw}</span> : big.raw;
  if (big.dir) {
    return (
      <b
        className={cn(
          "inline-flex items-center gap-[0.2em] rounded-[3px] px-[0.25em] font-[800] leading-[1.15] tracking-[-0.02em] tabular-nums",
          big.dir === "up" ? "bg-jade-weak text-jade" : "bg-surface text-ink-2",
          className
        )}
      >
        <Triangle dir={big.dir} />
        <span className="sr-only">{t(big.dir === "up" ? "trendUp" : "trendDown")}</span>
        {text}
      </b>
    );
  }
  return <b className={cn("font-[800] leading-[1.15] tracking-[-0.02em] text-jade tabular-nums", className)}>{text}</b>;
}

function Meter({ value, slim = false }: { value: number; slim?: boolean }) {
  return (
    <span className="block" aria-hidden="true">
      <span className={cn("block border border-rule bg-surface", slim ? "h-1.5" : "h-3")}>
        <span className="glance-grow block h-full bg-jade" style={{ width: `${Math.min(100, Math.max(2, value))}%` }} />
      </span>
      {!slim && (
        <span className="mt-0.5 flex justify-between text-[10px] text-ink-3">
          <span>0</span>
          <span>100%</span>
        </span>
      )}
    </span>
  );
}

function Bars({ fig, slim = false }: { fig: Extract<CardFigure, { kind: "bars" }>; slim?: boolean }) {
  const max = Math.max(...fig.items.map((i) => i.value ?? 0)) || 1;
  return (
    <ul className={cn("grid", slim ? "gap-1" : "gap-2")} aria-label={fig.items.map((i) => `${i.label} ${i.raw}`).join(", ")}>
      {fig.items.map((it, i) => {
        const on = i === (fig.emphasis ?? 0);
        return (
          <li key={i} className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-2", slim && "block")}>
            {!slim && <span className="truncate text-[12px] text-ink-2">{it.label}</span>}
            {!slim && <b className={cn("text-[13px] font-bold tabular-nums", on ? "text-jade" : "text-ink")}>{it.raw}</b>}
            <span aria-hidden="true" className={cn("col-span-2 block bg-surface", slim ? "h-1.5" : "mt-1 h-2.5")}>
              <span className={cn("glance-grow block h-full", on ? "bg-jade" : "bg-ink-3/40")} style={{ width: `${Math.max(3, ((it.value ?? 0) / max) * 100)}%` }} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** 숫자 목록 — 한 사건을 설명하는 서로 다른 단위의 숫자. 한 줄씩(칸이 세로로 길어지지 않게, 확정 시안 피드백) */
function NumberList({ fig }: { fig: Extract<CardFigure, { kind: "chain" }> }) {
  return (
    <ul className="grid gap-1">
      {fig.items.map((it, i) => (
        <li key={i} className="flex min-w-0 items-baseline gap-2 border-l-2 pl-2" style={{ borderColor: i === fig.emphasis ? "var(--jade)" : "var(--rule)" }}>
          <b className={cn("shrink-0 text-[13px] font-[800] tabular-nums", i === fig.emphasis ? "text-jade" : "text-ink")}>{it.raw}</b>
          <span className="min-w-0 truncate text-[11.5px] text-ink-2">{it.label}</span>
        </li>
      ))}
    </ul>
  );
}

function Timeline({ fig }: { fig: Extract<CardFigure, { kind: "timeline" }> }) {
  return (
    <ol className="relative grid gap-2 pl-5">
      <span aria-hidden="true" className="absolute bottom-2 left-[5px] top-2 w-0.5 bg-ink-3/40" />
      {fig.items.map((it, i) => (
        <li key={i} className="relative">
          <span aria-hidden="true" className={cn("absolute -left-5 top-[5px] h-3 w-3 rounded-full border-2", i === 0 ? "border-jade bg-jade" : "border-ink-3 bg-paper")} />
          <b className={cn("block text-[13px] font-bold", i === 0 ? "text-jade" : "text-ink")}>{it.when}</b>
          <span className="block text-[12px] leading-snug text-ink-2">{it.label}</span>
        </li>
      ))}
    </ol>
  );
}

function Figure({ fig }: { fig: CardFigure }) {
  if (fig.kind === "bars") return <Bars fig={fig} />;
  if (fig.kind === "chain") return <NumberList fig={fig} />;
  if (fig.kind === "timeline") return <Timeline fig={fig} />;
  return null;
}

/** 데스크톱 칸 (링크·강조는 감싸는 쪽) */
export function InfographicCell({ item }: { item: GlanceCell }) {
  return (
    <>
      <span className="flex flex-wrap items-center gap-x-2 text-[12px] text-ink-3">
        <span className="text-[17px] font-[800] leading-none text-ink">{item.rank}</span>
        <SectionTag code={item.section} label={item.sectionLabel} />
        {item.outlets && <span>{item.outlets}</span>}
      </span>
      <span className="mt-1.5 block text-[14.5px] font-[700] leading-[1.4] text-ink [text-wrap:pretty]">{item.title}</span>
      {item.big && (
        <span className="mt-2.5 block">
          <BigValue big={item.big} className="text-[23px]" />
          {item.fx && <span className="block text-[12.5px] font-semibold leading-snug text-ink-2 tabular-nums" data-testid="glance-fx">{item.fx}</span>}
          <span className="mt-0.5 block text-[12px] leading-snug text-ink-2">{item.big.label}</span>
          {item.big.meter != null && (
            <span className="mt-2 block">
              <Meter value={item.big.meter} />
            </span>
          )}
        </span>
      )}
      {item.figure && (
        <span className="mt-3 block">
          <Figure fig={item.figure} />
        </span>
      )}
      {item.note && <span className="mt-auto block pt-3 text-[12px] leading-[1.5] text-ink-3">{item.note}</span>}
    </>
  );
}

/** 휴대폰 줄: 왼쪽 분야·제목, 오른쪽 큰 숫자 + 작은 그래프 (다섯 건이 한 화면에) */
export function InfographicRow({ item }: { item: GlanceCell }) {
  const fig = item.figure;
  return (
    <>
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-[11.5px]">
          <b className="text-[13px] text-ink">{item.rank}</b>
          <SectionTag code={item.section} label={item.sectionLabel} />
        </span>
        <span className="mt-0.5 block text-[14px] font-[650] leading-[1.4] text-ink [text-wrap:pretty]">{item.title}</span>
      </span>
      <span className="grid min-w-[84px] max-w-[124px] content-start justify-items-end gap-0.5 text-right">
        {item.big && (
          <>
            <BigValue big={item.big} className="text-[16px]" />
            {item.fx && <span className="text-[11px] font-semibold leading-tight text-ink-2 tabular-nums" data-testid="glance-fx">{item.fx}</span>}
            <span className="text-[10.5px] leading-tight text-ink-3">{item.big.label}</span>
          </>
        )}
        {item.big?.meter != null ? (
          <span className="mt-0.5 block w-[84px]">
            <Meter value={item.big.meter} slim />
          </span>
        ) : fig?.kind === "bars" ? (
          <span className="mt-0.5 block w-[84px]">
            <Bars fig={fig} slim />
          </span>
        ) : fig?.kind === "timeline" ? (
          <span className="text-[10.5px] font-semibold text-ink-2">{fig.items.map((i) => i.when).join(" → ")}</span>
        ) : !item.big && fig?.kind === "chain" ? (
          <span className="text-[10.5px] text-ink-2">{fig.items.map((i) => i.raw).join(" · ")}</span>
        ) : null}
      </span>
    </>
  );
}

/**
 * 가로형 한 장 그림 (1600px, 아침 메일·공유용 PNG). 페이지 데스크톱 칸과 같은 InfographicCell 을 한 줄로 + 머리·꼬리.
 * 막대 차오름은 끈다(.no-anim) — 찍는 순간 다 찬 상태. Playwright 가 [data-testid=briefing-card] 를 2배로 찍는다.
 */
export function BriefingInfographic({
  items,
  edition_date,
  locale,
  headline,
  moreCount,
  outlets,
  fx,
}: {
  items: GlanceCell[];
  /** 칸에 금액 환산 줄이 있으면 그 환율 (바닥 각주) */
  fx?: FxRates | null;
  edition_date: string;
  locale: string;
  headline: string;
  moreCount: number;
  outlets: string[];
}) {
  const t = useTranslations("briefing");
  const tm = useTranslations("meta");
  return (
    <div
      data-testid="briefing-card"
      className="no-anim w-[1600px] bg-paper px-12 pb-6 text-ink [color-scheme:light] [font-feature-settings:'tnum'] [word-break:keep-all]"
    >
      <div className="flex items-baseline justify-between border-b border-rule-strong border-t-[8px] border-t-jade pb-3 pt-5 text-[17px]">
        <p>
          <span className="mr-3 font-bold text-jade">{tm("brand")}</span>
          <b className="text-[19px]">{t("kicker")}</b>
        </p>
        <span className="text-ink-2">
          {formatDateGroup(edition_date, locale)} · {t("tocTitle", { count: items.length })}
        </span>
      </div>
      <h1 className="mt-5 text-[38px] font-[800] leading-[1.25] tracking-[-0.03em]">{headline}</h1>
      <ol className="mt-6 grid border-t-2 border-rule-strong" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
        {items.map((it) => (
          <li key={it.rank} className="flex min-w-0 flex-col border-r border-rule px-5 py-5 first:pl-0 last:border-r-0 last:pr-0">
            <InfographicCell item={it} />
          </li>
        ))}
      </ol>
      <p className="mt-4 flex justify-between gap-5 border-t border-rule-strong pt-2.5 text-[13px] text-ink-3">
        <span>
          <b className="text-ink">{t("sources")}</b> {outlets.join("·")} · {t("aiLabel")}
          {moreCount > 0 && <> · {t("infographicMore", { count: moreCount })}</>}
        </span>
        <span className="whitespace-nowrap">{t("cardChecked")}</span>
      </p>
      {fx && <FxNote fx={fx} locale={locale} className="mt-1 block text-[12.5px] text-ink-3" />}
    </div>
  );
}
