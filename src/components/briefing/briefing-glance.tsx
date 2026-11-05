import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { InfographicCell, InfographicRow, type GlanceCell } from "./infographic";
import { GlanceLink } from "./glance-link";

/*
 * "한눈에 보기" — 확정 시안 2026-11-05 (5안 화면 폭에 따라 바뀌는 요약 보드, claude.ai artifact 6AeaKgMa…).
 * 데스크톱(lg 이상): 다섯 칸 인포그래픽 = 아침 메일 그림과 같은 칸(InfographicCell, Gate 2).
 * 휴대폰·태블릿: 다섯 줄 요약 — 넘기지 않아도 다섯 건이 한 화면에(InfographicRow).
 * 칸·줄을 누르면 그 기사로 이동만 한다(음성 재생 없음). 음성이 그 기사를 읽는 동안에는 칸이 밝아진다(GlanceLink).
 * 화면에서 바로 보이므로 한 장 요약·이미지 저장 버튼은 두지 않고 공유만(actions).
 */
export function BriefingGlance({ items, actions, className }: { items: GlanceCell[]; actions?: ReactNode; className?: string }) {
  const t = useTranslations("briefing");
  if (!items.length) return null;
  return (
    <section aria-labelledby="glance-h" className={cn("min-w-0", className)} data-testid="briefing-glance">
      <div className="flex items-center justify-between gap-x-3 border-b-2 border-rule-strong pb-2">
        <h2 id="glance-h" className="shrink-0 text-[15px] font-bold text-ink">
          {t("glanceTitle")} <span className="ml-1 text-[13px] font-normal text-ink-3">{t("tocTitle", { count: items.length })}</span>
        </h2>
        {actions}
      </div>

      {/* 데스크톱: 다섯 칸 */}
      <ol className="hidden lg:grid" style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0,1fr))` }}>
        {items.map((it) => (
          <li key={it.rank} className="min-w-0 border-r border-rule last:border-r-0">
            <GlanceLink rank={it.rank} variant="cell">
              <InfographicCell item={it} />
            </GlanceLink>
          </li>
        ))}
      </ol>

      {/* 휴대폰·태블릿: 다섯 줄 */}
      <ol className="lg:hidden">
        {items.map((it) => (
          <li key={it.rank} className="border-b border-rule">
            <GlanceLink rank={it.rank} variant="row">
              <InfographicRow item={it} />
            </GlanceLink>
          </li>
        ))}
      </ol>
    </section>
  );
}
