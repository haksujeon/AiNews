"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

/**
 * 데스크톱 오른쪽 칸 맨 위에 따라 내려오는 "읽는 위치" (안 A, 2026-11-05).
 * 머리의 목차를 없앤 대신, 기사를 읽는 동안 지금 몇 번 기사인지와 다른 기사로 가는 길을 준다.
 * 누르면 그 기사로 이동만 한다 (음성 재생 없음).
 */
export function StoryProgress({ stories }: { stories: { rank: number; title: string }[] }) {
  const t = useTranslations("briefing");
  const [current, setCurrent] = useState<number | null>(null);

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const els = stories.map((s) => document.getElementById(`story-${s.rank}`)).filter((e): e is HTMLElement => !!e);
    const seen = new Map<number, boolean>();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(Number(e.target.id.replace("story-", "")), e.isIntersecting);
        const on = [...seen.entries()].filter(([, v]) => v).map(([k]) => k);
        setCurrent(on.length ? Math.min(...on) : null);
      },
      // 화면 위쪽 1/3 띠에 걸린 기사를 "읽는 중"으로 본다
      { rootMargin: "-15% 0px -55% 0px" }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [stories]);

  if (!stories.length) return null;
  return (
    <nav aria-label={t("readingNow")} className="border-b border-rule pb-4 pt-6" data-testid="story-progress">
      <h2 className="mb-2 border-b border-rule-strong pb-2 text-sm font-bold text-ink">{t("readingNow")}</h2>
      <ol className="grid gap-0.5">
        {stories.map((s) => {
          const on = current === s.rank;
          return (
            <li key={s.rank}>
              <a
                href={`#story-${s.rank}`}
                aria-current={on ? "location" : undefined}
                className={cn(
                  "flex min-h-9 items-start gap-2.5 rounded-sm py-1 text-[13.5px] leading-[1.45] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  on ? "font-[650] text-ink" : "text-ink-3 hover:text-ink"
                )}
              >
                <span className={cn("w-4 shrink-0 font-bold", on ? "text-jade" : "")}>{s.rank}</span>
                <span className="min-w-0">{s.title}</span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
