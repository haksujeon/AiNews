"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PublicBriefing } from "@/lib/briefing/public";
import { outletsOf } from "@/lib/briefing/view";
import { Sources, sectionLabel } from "@/components/briefing/briefing-view";

/**
 * "오늘" 홈 브리핑 히어로의 주요 기사 — 줄을 누르면 그 자리에서 what·"왜 중요한가"·근거 기사가 펼쳐진다 (페이지 이동 없음).
 * 문구·근거 링크·분야 이름은 브리핑 페이지와 같은 부품(Sources·sectionLabel·outletsOf)을 쓴다 (Gate 2).
 * 처음에는 1위가 펼쳐져 있다. 한 번에 하나만 펼친다.
 */
export function TodayStories({ briefing }: { briefing: PublicBriefing }) {
  const t = useTranslations("briefing");
  const [open, setOpen] = useState(0);
  const stories = briefing.content.top_stories;
  return (
    <ol className="border-t border-white/15" data-testid="today-stories">
      {stories.map((s, i) => {
        const expanded = open === i;
        const outlets = outletsOf(s.refs, briefing.articles).length;
        const panelId = `today-story-${s.rank}`;
        return (
          <li key={s.rank} className="border-b border-white/15">
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={panelId}
              onClick={() => setOpen(expanded ? -1 : i)}
              className="flex min-h-[52px] w-full items-center gap-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-jade-bright sm:gap-4"
            >
              <span aria-hidden="true" className="w-6 shrink-0 font-mono text-sm text-jade-bright">
                {String(s.rank).padStart(2, "0")}
              </span>
              <span className="hidden shrink-0 rounded-[3px] border border-white/20 px-1.5 text-[11px] leading-5 text-white/70 sm:inline">
                {sectionLabel(t, s.section)}
              </span>
              <span className="min-w-0 flex-1 text-[15.5px] font-semibold leading-[1.45] text-white sm:text-base">{s.title}</span>
              <ChevronDown
                aria-hidden="true"
                className={cn("h-4 w-4 shrink-0 text-white/60 transition-transform motion-reduce:transition-none", expanded && "rotate-180")}
              />
            </button>
            <div id={panelId} hidden={!expanded} className="pb-4 pl-9 sm:pl-10">
              <p className="text-[15px] leading-[1.75] text-white/80">{s.what}</p>
              {s.why && (
                <p className="mt-2 text-[15px] leading-[1.7] text-white/90">
                  <span className="mr-2 text-[12.5px] font-[650] text-jade-bright">{t("whyItMatters")}</span>
                  {s.why}
                </p>
              )}
              <div className="mt-2 flex flex-wrap items-baseline gap-x-3 text-[13px] text-white/60">
                {outlets >= 2 && <span>{t("outlets", { count: outlets })}</span>}
                <Sources
                  refs={s.refs}
                  briefing={briefing}
                  className="text-white/60 [&_a]:text-white/80 [&_a]:decoration-white/30 hover:[&_a]:decoration-white/70"
                />
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
