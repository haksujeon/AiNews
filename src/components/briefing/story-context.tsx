import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { getSourceName } from "@/lib/news-utils";
import { DetailsCollapse } from "./details-collapse";
import type { StoryContext } from "@/lib/briefing/types";

/**
 * "회사·관련 주제 히스토리 분석" 상자 (시범, 2026-11-04) — 주요 기사 하나의 과거 흐름, 관점 두 개(회사·관련 주제).
 * 쉬운 AI 설명 상자(easy-terms.tsx)와 같은 방식: <details> 라 서버·클라이언트 어디서 그려도 같고 처음에는 접혀 있다.
 * 화면(시안 A, 사용자 결정 2026-11-04): 접혀 있을 때는 다른 상자와 같은 40rem 폭 + 두 흐름 제목 미리보기,
 * 펼치면 본문 칸 전체 폭으로 넓어지고 md 이상에서 두 관점을 나란히 두 칸으로 (휴대폰은 위아래).
 * 쓰는 곳: 브리핑 페이지·날짜 팝업(TopStoryItem)·홈 히어로(TodayStories, tone="dark")·주간/월간 — 부품 하나 (Gate 2).
 * 형식: 배경 2문장 → 연대기(보도 날짜 · 한 문장 · 근거 기사 링크) → 이번 기사. 기사마다 숫자가 다르면 주의 한 줄.
 */
export function StoryContextBox({ contexts, tone = "light", className }: { contexts?: StoryContext[]; tone?: "light" | "dark"; className?: string }) {
  const t = useTranslations("briefing");
  if (!contexts?.length) return null;
  // 홈 히어로(어두운 카드)용 색 — 쉬운 AI 설명 상자(EasyTerms tone="dark")와 같은 짝
  const dark = tone === "dark";
  const c1 = dark ? "text-white" : "text-ink"; // 제목·본문
  const c2 = dark ? "text-white/75" : "text-ink-2"; // 배경 설명
  const c3 = dark ? "text-white/55" : "text-ink-3"; // 날짜·출처·주석
  const accent = dark ? "text-jade-bright" : "text-jade";
  const line = dark ? "border-white/10" : "border-rule";
  const lensLabel = (c: StoryContext) => t(c.lens === "company" ? "storyLensCompany" : "storyLensTopic");
  return (
    <details
      className={cn(
        "group max-w-[40rem] rounded-[4px] border transition-[max-width] duration-300 ease-out open:max-w-full motion-reduce:transition-none",
        dark ? "border-white/15 bg-white/[0.04]" : "border-rule bg-surface",
        className
      )}
      data-testid="story-context"
    >
      <summary
        className={cn(
          "flex min-h-11 cursor-pointer list-none items-center gap-2 px-3.5 py-2 text-[14px] font-[650] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset [&::-webkit-details-marker]:hidden",
          dark ? "text-white focus-visible:ring-jade-bright" : "text-ink focus-visible:ring-ring"
        )}
      >
        <span className="shrink-0">{t("storyTitle")}</span>
        <span className={cn("shrink-0 whitespace-nowrap rounded-[3px] border px-1.5 py-px text-[11px] font-semibold", dark ? "border-white/25 text-white/60" : "border-rule-strong/40 text-ink-3")}>{t("storyBeta")}</span>
        {/* 미리보기는 휴대폰에서 "De…" 처럼 잘려 의미가 없어 숨긴다 (쉬운 AI 설명 상자와 같게) */}
        <span className={cn("ml-auto min-w-0 truncate text-[12.5px] font-normal max-sm:hidden", c3)} aria-hidden="true">
          <span className="group-open:hidden">{contexts.map((c) => c.title).join(" · ")}</span>
        </span>
        <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 max-sm:ml-auto transition-transform group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className={cn("grid border-t", line, contexts.length > 1 && "md:grid-cols-2")}>
        {contexts.map((c, i) => (
          <section
            key={c.lens}
            className={cn("min-w-0 px-4 pb-4 pt-3.5", i > 0 && cn("border-t md:border-l md:border-t-0", line))}
            aria-label={lensLabel(c)}
          >
            <p className={cn("text-[12px] font-bold tracking-[0.02em]", accent)}>{lensLabel(c)}</p>
            <h4 className={cn("mt-0.5 text-[16px] font-bold leading-[1.45] [text-wrap:balance]", c1)}>{c.title}</h4>
            <p className={cn("mt-2 text-[14.5px] leading-[1.7]", c2)}>{c.background}</p>
            {/* 연대기: 세로 선 + 점, 마지막 "이번 기사"는 채운 마름모 */}
            <ol className={cn("relative mt-3 space-y-2.5 before:absolute before:bottom-1.5 before:left-[5px] before:top-1.5 before:w-px", dark ? "before:bg-jade-bright/40" : "before:bg-jade/40")}>
              {c.timeline.map((it, k) => (
                <li
                  key={k}
                  className={cn(
                    "relative pl-[22px] before:absolute before:left-px before:top-[7px] before:h-[9px] before:w-[9px] before:rounded-full before:border-2",
                    dark ? "before:border-jade-bright before:bg-console" : "before:border-jade before:bg-surface"
                  )}
                >
                  <time dateTime={it.date} className={cn("font-mono text-[12px] tabular-nums", c3)}>
                    {it.date.slice(5).replace("-", ".")}
                  </time>
                  <p className={cn("text-[14.5px] leading-[1.65]", c1)}>{it.text}</p>
                  {it.refs.length > 0 && (
                    <p className={cn("mt-0.5 flex flex-col text-[12px] leading-[1.5]", c3)}>
                      {it.refs.slice(0, 2).map((r) => (
                        <Link
                          key={r.id}
                          href={`/news/${r.id}`}
                          className={cn(
                            "min-w-0 max-w-full truncate rounded-sm py-0.5 underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 max-sm:py-1.5",
                            dark ? "decoration-white/30 hover:text-white focus-visible:ring-jade-bright" : "decoration-rule-strong/40 hover:text-ink focus-visible:ring-ring"
                          )}
                        >
                          {/* 매체 이름은 다른 곳과 같은 원어 표기 (36Kr → 36氪) */}
                          {getSourceName(r.source)} · {r.title}
                        </Link>
                      ))}
                    </p>
                  )}
                </li>
              ))}
              <li className={cn("relative pl-[22px] before:absolute before:left-[1.5px] before:top-[7px] before:h-[8px] before:w-[8px] before:rotate-45 before:rounded-[1px]", dark ? "before:bg-jade-bright" : "before:bg-jade")}>
                <span className={cn("text-[12px] font-bold", accent)}>{t("storyNow")}</span>
                <p className={cn("text-[14.5px] leading-[1.65]", c1)}>{c.now}</p>
              </li>
            </ol>
            {c.caution && <p className={cn("mt-1.5 pl-[22px] text-[12.5px] leading-[1.55]", c3)}>※ {c.caution}</p>}
          </section>
        ))}
      </div>
      <div className={cn("flex items-start justify-between gap-3 border-t pb-1 pl-4 pr-2 pt-2", line)}>
        <p className={cn("pb-2 text-[12px] leading-[1.55]", c3)}>{t("storyNote")}</p>
        <DetailsCollapse label={t("storyCollapse")} tone={tone} />
      </div>
    </details>
  );
}
