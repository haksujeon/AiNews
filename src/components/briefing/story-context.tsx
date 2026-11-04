import { useTranslations } from "next-intl";
import { ChevronDown } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import type { StoryContext } from "@/lib/briefing/types";

/**
 * "지금까지의 이야기" 상자 (시범, 2026-11-04) — 주요 기사 하나의 과거 흐름, 관점 두 개(회사 흐름·주제 흐름).
 * 쉬운 AI 설명 상자(easy-terms.tsx)와 같은 모양·같은 방식: <details> 라 서버·클라이언트 어디서 그려도 같고 처음에는 접혀 있다.
 * 형식: 배경 2문장 → 연대기(보도 날짜 · 한 문장 · 근거 기사 링크) → 이번 기사. 기사마다 숫자가 다르면 주의 한 줄.
 */
export function StoryContextBox({ contexts, className }: { contexts?: StoryContext[]; className?: string }) {
  const t = useTranslations("briefing");
  if (!contexts?.length) return null;
  return (
    <details className={cn("group rounded-[4px] border border-rule bg-surface", className)} data-testid="story-context">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3.5 py-2 text-[14px] font-[650] text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span>{t("storyTitle")}</span>
        <span className="rounded-[3px] border border-rule-strong/40 px-1.5 py-px text-[11px] font-semibold text-ink-3">{t("storyBeta")}</span>
        <span className="ml-auto min-w-0 truncate text-[12.5px] font-normal text-ink-3" aria-hidden="true">
          <span className="group-open:hidden">{contexts.map((c) => t(c.lens === "company" ? "storyLensCompany" : "storyLensTopic")).join(" · ")}</span>
        </span>
        <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="border-t border-rule px-3.5 pb-3">
        {contexts.map((c) => (
          <section key={c.lens} className="border-b border-rule py-3 last:border-b-0" aria-label={t(c.lens === "company" ? "storyLensCompany" : "storyLensTopic")}>
            <p className="text-[12.5px] font-[650] text-jade">{t(c.lens === "company" ? "storyLensCompany" : "storyLensTopic")}</p>
            <h4 className="mt-0.5 text-[15.5px] font-bold leading-[1.45] text-ink">{c.title}</h4>
            <p className="mt-1.5 text-[15px] leading-[1.7] text-ink-2">{c.background}</p>
            <ol className="mt-2.5 space-y-2 border-l border-jade/40 pl-3">
              {c.timeline.map((it, i) => (
                <li key={i} className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-2">
                  <time dateTime={it.date} className="pt-px font-mono text-[12.5px] text-ink-3">
                    {it.date.slice(5).replace("-", ".")}
                  </time>
                  <div className="min-w-0">
                    <p className="text-[14.5px] leading-[1.65] text-ink">{it.text}</p>
                    <p className="mt-0.5 flex flex-wrap gap-x-2 text-[12px] leading-[1.5] text-ink-3">
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
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-2.5 text-[14.5px] leading-[1.65] text-ink">
              <span className="mr-1.5 font-[650] text-jade">{t("storyNow")}</span>
              {c.now}
            </p>
            {c.caution && <p className="mt-1.5 text-[12.5px] leading-[1.55] text-ink-3">{c.caution}</p>}
          </section>
        ))}
        <p className="pt-2 text-[12px] leading-[1.55] text-ink-3">{t("storyNote")}</p>
      </div>
    </details>
  );
}
