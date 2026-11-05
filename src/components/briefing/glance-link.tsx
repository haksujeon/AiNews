"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { usePlayingStory } from "./briefing-media";

/**
 * 한눈에 보기 칸·줄의 링크. 누르면 그 기사(#story-N)로 이동만 한다 (사용자 결정 2026-11-05: 음성 재생 없음).
 * 음성이 이 기사를 읽는 중이면 밝아지고 아래 진행 막대가 움직인다 (확정 시안의 듣기 연동).
 */
export function GlanceLink({ rank, variant, children }: { rank: number; variant: "cell" | "row"; children: ReactNode }) {
  const t = useTranslations("briefing");
  const playing = usePlayingStory();
  const on = playing?.rank === rank;
  return (
    <a
      href={`#story-${rank}`}
      aria-current={on ? "true" : undefined}
      className={cn(
        "relative transition-colors duration-300 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none",
        variant === "cell" ? "flex h-full min-h-[150px] flex-col px-4 py-4" : "grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-2.5",
        on && "bg-jade-weak hover:bg-jade-weak"
      )}
      data-testid="glance-item"
    >
      {children}
      {on && (
        <>
          <span className={cn("text-[10.5px] font-bold text-jade", variant === "cell" ? "absolute right-3 top-3" : "sr-only")}>{t("playingNow")}</span>
          <span aria-hidden="true" className="absolute bottom-0 left-0 h-[3px] bg-jade" style={{ width: `${Math.round(playing!.progress * 100)}%` }} />
        </>
      )}
    </a>
  );
}
