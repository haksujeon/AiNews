import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EasyTerm } from "@/lib/briefing/types";

/**
 * "쉬운 AI 설명" 상자 — 주요 기사 하나의 어려운 용어 2~3개 (easy-terms.ts). 처음에는 접혀 있다.
 * 홈 히어로(TodayStories, 어두운 바탕)·브리핑 페이지·날짜 팝업(TopStoryItem)이 이 부품 하나를 쓴다 (Gate 2).
 * <details> 라 서버·클라이언트 어디서 그려도 같고, 키보드(Enter/Space)·화면 낭독기가 기본으로 된다.
 */
export function EasyTerms({ terms, locale, tone = "light", className }: { terms?: EasyTerm[]; locale: string; tone?: "light" | "dark"; className?: string }) {
  const t = useTranslations("briefing");
  if (!terms?.length) return null;
  const dark = tone === "dark";
  return (
    <details
      className={cn(
        "group rounded-[4px] border",
        dark ? "border-white/15 bg-white/[0.04]" : "border-jade/30 bg-jade-weak",
        className
      )}
      data-testid="easy-terms"
    >
      <summary
        className={cn(
          "flex min-h-11 cursor-pointer list-none items-center gap-2 px-3.5 py-2 text-[14px] font-[650] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset [&::-webkit-details-marker]:hidden",
          dark ? "text-jade-bright focus-visible:ring-jade-bright" : "text-jade focus-visible:ring-ring"
        )}
      >
        {/* 360px 폭에서 제목이 두 줄로 꺾이던 것 (UI 검토 2026-11-04) → 제목·개수는 줄바꿈하지 않고, 휴대폰은 미리보기를 숨긴다 */}
        <span className="shrink-0 whitespace-nowrap">{t("easyTitle")}</span>
        <span className={cn("shrink-0 whitespace-nowrap text-[12.5px] font-normal", dark ? "text-white/60" : "text-ink-3")}>{t("easyCount", { count: terms.length })}</span>
        <span className={cn("ml-auto min-w-0 truncate text-[12.5px] font-normal max-sm:hidden", dark ? "text-white/60" : "text-ink-3")} aria-hidden="true">
          <span className="group-open:hidden">{terms.map((x) => x.name).join(" · ")}</span>
        </span>
        <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 max-sm:ml-auto transition-transform group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <ul className={cn("border-t px-3.5 pb-3", dark ? "border-white/10" : "border-jade/20")}>
        {terms.map((x) => (
          <li key={x.term} className={cn("border-b py-2.5 last:border-b-0", dark ? "border-white/10" : "border-jade/15")}>
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className={cn("text-[15px] font-bold", dark ? "text-white" : "text-ink")}>{x.name}</span>
              {x.name !== x.term && (
                <span lang="zh-CN" className={cn("font-han text-[13px]", dark ? "text-white/60" : "text-ink-3")}>
                  {x.term}
                </span>
              )}
              {locale !== "zh" && x.pinyin && <span className={cn("font-mono text-[11.5px]", dark ? "text-white/50" : "text-ink-3")}>{x.pinyin}</span>}
            </p>
            <p className={cn("mt-1 text-[15px] leading-[1.7]", dark ? "text-white/90" : "text-ink")}>{x.easy}</p>
            {x.detail && (
              <p className={cn("mt-1 text-[13px] leading-[1.6]", dark ? "text-white/55" : "text-ink-3")}>
                <span className="mr-1.5 font-semibold">{t("easyDetail")}</span>
                {x.detail}
              </p>
            )}
          </li>
        ))}
        <li className={cn("pt-2 text-[12px]", dark ? "text-white/45" : "text-ink-3")}>{t("easyNote")}</li>
      </ul>
    </details>
  );
}
