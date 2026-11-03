import { Link } from "@/i18n/navigation";
import { getTitle } from "@/lib/news-utils";
import { daysBetween } from "@/lib/metrics/period";
import type { CompanyEvent } from "@/lib/companies";
import { cn } from "@/lib/utils";

/**
 * 기업·이슈 공용 조각 (서버 렌더). 큰 이슈 목록은 캔버스 대신 HTML — 긴 제목이 휴대폰에서도 줄바꿈되고 링크가 된다.
 * 날짜 띠: 구간의 하루 = 한 칸, 보도된 날은 칠한 칸 (시안의 "떠 있는 막대"를 칸으로). 칸은 왼쪽부터 차례로 차오른다(.cx-fill).
 */
export function shortDate(day: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : locale === "en" ? "en-US" : "ko-KR", { month: "numeric", day: "numeric", timeZone: "UTC" }).format(
    new Date(`${day}T00:00:00Z`)
  );
}

export function changeLabel(v: number | null): string {
  if (v == null) return "—";
  return `${v > 0 ? "▲" : v < 0 ? "▼" : ""}${Math.abs(v)}%`;
}

export function EventList({
  events,
  titles,
  locale,
  range,
  labels,
  testId,
}: {
  events: CompanyEvent[];
  titles: Map<string, { title_cn: string; title_kr: string; title_en: string }>;
  locale: string;
  range: { start: string; end: string };
  labels: { sources: (n: number) => string; articles: (n: number) => string };
  testId: string;
}) {
  const days = daysBetween(range.start, range.end);
  // 7일은 넓은 칸, 4주는 좁은 칸 (390px 폭에서도 한 줄: 28 × 8px + 간격)
  const cell = days.length > 10 ? "w-[7px] sm:w-[9px]" : "w-5 sm:w-6";
  return (
    <ol className="divide-y divide-rule border-y border-rule" data-testid={testId}>
      {events.map((e, i) => {
        const t = titles.get(e.primary_id);
        const title = t ? getTitle(t, locale) : "";
        const on = new Set(e.days);
        return (
          <li key={e.primary_id} className="grid gap-2 py-3.5 sm:grid-cols-[1fr_auto] sm:items-center sm:gap-6">
            <div className="min-w-0">
              <Link href={`/news/${e.primary_id}`} className="text-[15px] font-semibold leading-snug text-ink hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                {title}
              </Link>
              <p className="mt-1 font-mono text-[12px] text-ink-3">
                {labels.sources(e.sources.length)} · {labels.articles(e.ids.length)} · {e.days.map((d) => shortDate(d, locale)).join(", ")}
              </p>
            </div>
            <div className={cn("flex", days.length > 10 ? "gap-[2px]" : "gap-[3px]")} aria-hidden="true">
              {days.map((d, j) => (
                <span key={d} className={cn("h-3.5 overflow-hidden rounded-[2px] bg-surface ring-1 ring-inset ring-rule", cell)}>
                  {on.has(d) && <span className="cx-fill block h-full w-full bg-jade" style={{ animationDelay: `${i * 60 + j * 40}ms` }} />}
                </span>
              ))}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

export function SectionHead({ id, title, sub, className }: { id: string; title: string; sub?: string; className?: string }) {
  return (
    <div className={cn("mb-4 border-b-2 border-ink pb-2.5", className)}>
      <h2 id={id} className="text-[20px] font-[800] tracking-[-0.02em] text-ink sm:text-[22px]">
        {title}
      </h2>
      {sub && <p className="mt-1 text-[13px] text-ink-3">{sub}</p>}
    </div>
  );
}
