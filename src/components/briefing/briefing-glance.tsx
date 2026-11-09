import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { GroupLabel, InfographicCell, InfographicRow, glanceGroups, type GlanceCell } from "./infographic";
import { GlanceLink } from "./glance-link";

/*
 * "한눈에 보기" — 확정 시안 2026-11-05 (5안 화면 폭에 따라 바뀌는 요약 보드, claude.ai artifact 6AeaKgMa…).
 * 데스크톱(lg 이상): 다섯 칸 인포그래픽 = 아침 메일 그림과 같은 칸(InfographicCell, Gate 2).
 * 휴대폰·태블릿: 다섯 줄 요약 — 넘기지 않아도 다섯 건이 한 화면에(InfographicRow).
 * 2026-11-09~ 판은 "중국 5건"·"해외 3건" 두 묶음(번호도 묶음마다 1부터, story-groups.ts). 예전 판은 한 묶음 그대로.
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

      {glanceGroups(items).map((g) => (
        <div key={g.group ?? "all"}>
          {/* 묶은 판(2026-11-09~): "중국 5건" · "해외 3건" 두 묶음, 해외 칸도 중국 칸과 같은 폭 */}
          {g.group && <GroupLabel group={g.group} count={g.items.length} className="pb-1 pt-3" />}

          {/* 데스크톱: 칸 */}
          <ol className={cn("hidden lg:grid", g.group === "intl" && "border-t border-rule")} style={{ gridTemplateColumns: `repeat(${g.cols}, minmax(0,1fr))` }}>
            {g.items.map((it, i) => (
              <li key={it.rank} className={cn("min-w-0 border-rule", i < g.items.length - 1 || g.items.length < g.cols ? "border-r" : "")}>
                <GlanceLink rank={it.rank} variant="cell">
                  <InfographicCell item={it} />
                </GlanceLink>
              </li>
            ))}
          </ol>

          {/* 휴대폰·태블릿: 줄 */}
          <ol className="lg:hidden">
            {g.items.map((it) => (
              <li key={it.rank} className="border-b border-rule">
                <GlanceLink rank={it.rank} variant="row">
                  <InfographicRow item={it} />
                </GlanceLink>
              </li>
            ))}
          </ol>
        </div>
      ))}
    </section>
  );
}
