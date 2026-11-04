import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { StoryContext } from "@/lib/briefing/types";

/**
 * "회사·관련 주제 히스토리 분석" 상자 (시범, 2026-11-04) — 주요 기사 하나의 과거 흐름, 관점 두 개(회사·관련 주제).
 * 쉬운 AI 설명 상자(easy-terms.tsx)와 같은 방식: <details> 라 서버·클라이언트 어디서 그려도 같고 처음에는 접혀 있다.
 * 화면(시안 A, 사용자 결정 2026-11-04): 접혀 있을 때는 다른 상자와 같은 40rem 폭 + 두 흐름 제목 미리보기,
 * 펼치면 본문 칸 전체 폭으로 넓어지고 md 이상에서 두 관점을 나란히 두 칸으로 (휴대폰은 위아래).
 * 형식: 배경 2문장 → 연대기(보도 날짜 · 한 문장 · 근거 기사 링크) → 이번 기사. 기사마다 숫자가 다르면 주의 한 줄.
 */
export function StoryContextBox({ contexts, className }: { contexts?: StoryContext[]; className?: string }) {
  const t = useTranslations("briefing");
  if (!contexts?.length) return null;
  const lensLabel = (c: StoryContext) => t(c.lens === "company" ? "storyLensCompany" : "storyLensTopic");
  return (
    <details
      className={cn(
        "group max-w-[40rem] rounded-[4px] border border-rule bg-surface transition-[max-width] duration-300 ease-out open:max-w-full motion-reduce:transition-none",
        className
      )}
      data-testid="story-context"
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3.5 py-2 text-[14px] font-[650] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span className="shrink-0">{t("storyTitle")}</span>
        <span className="shrink-0 whitespace-nowrap rounded-[3px] border border-rule-strong/40 px-1.5 py-px text-[11px] font-semibold text-ink-3">{t("storyBeta")}</span>
        <span className="ml-auto min-w-0 truncate text-[12.5px] font-normal text-ink-3" aria-hidden="true">
          <span className="group-open:hidden">{contexts.map((c) => c.title).join(" · ")}</span>
        </span>
        <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className={cn("grid border-t border-rule", contexts.length > 1 && "md:grid-cols-2")}>
        {contexts.map((c, i) => (
          <section
            key={c.lens}
            className={cn("min-w-0 px-4 pb-4 pt-3.5", i > 0 && "border-t border-rule md:border-l md:border-t-0")}
            aria-label={lensLabel(c)}
          >
            <p className="text-[12px] font-bold tracking-[0.02em] text-jade">{lensLabel(c)}</p>
            <h4 className="mt-0.5 text-[16px] font-bold leading-[1.45] text-ink [text-wrap:balance]">{c.title}</h4>
            <p className="mt-2 text-[14.5px] leading-[1.7] text-ink-2">{c.background}</p>
            {/* 연대기: 세로 선 + 점, 마지막 "이번 기사"는 채운 마름모 */}
            <ol className="relative mt-3 space-y-2.5 before:absolute before:bottom-1.5 before:left-[5px] before:top-1.5 before:w-px before:bg-jade/40">
              {c.timeline.map((it, k) => (
                <li
                  key={k}
                  className="relative pl-[22px] before:absolute before:left-px before:top-[7px] before:h-[9px] before:w-[9px] before:rounded-full before:border-2 before:border-jade before:bg-surface"
                >
                  <time dateTime={it.date} className="font-mono text-[12px] tabular-nums text-ink-3">
                    {it.date.slice(5).replace("-", ".")}
                  </time>
                  <p className="text-[14.5px] leading-[1.65] text-ink">{it.text}</p>
                  {it.refs.length > 0 && (
                    <p className="mt-0.5 flex flex-col text-[12px] leading-[1.5] text-ink-3">
                      {it.refs.slice(0, 2).map((r) => (
                        <Link
                          key={r.id}
                          href={`/news/${r.id}`}
                          className="min-w-0 max-w-full truncate rounded-sm underline decoration-rule-strong/40 underline-offset-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {r.source} · {r.title}
                        </Link>
                      ))}
                    </p>
                  )}
                </li>
              ))}
              <li className="relative pl-[22px] before:absolute before:left-[1.5px] before:top-[7px] before:h-[8px] before:w-[8px] before:rotate-45 before:rounded-[1px] before:bg-jade">
                <span className="text-[12px] font-bold text-jade">{t("storyNow")}</span>
                <p className="text-[14.5px] leading-[1.65] text-ink">{c.now}</p>
              </li>
            </ol>
            {c.caution && <p className="mt-1.5 pl-[22px] text-[12.5px] leading-[1.55] text-ink-3">※ {c.caution}</p>}
          </section>
        ))}
      </div>
      <p className="border-t border-rule px-4 pb-3 pt-2 text-[12px] leading-[1.55] text-ink-3">{t("storyNote")}</p>
    </details>
  );
}
