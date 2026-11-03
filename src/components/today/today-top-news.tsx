import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { NewsDay } from "@/lib/news-types";
import { formatDateGroup } from "@/lib/news-utils";
import { NewsCard } from "@/components/news/news-card";

/**
 * "오늘" 홈의 주요 뉴스: 가장 최근 날의 공용 순위 상위(뉴스 목록의 "주요 4건"과 같은 fetchNewsDays·news-rank, Gate 2).
 * 1위는 크게(2칸×2줄), 나머지는 작은 카드. 카드는 뉴스 목록과 같은 NewsCard (국기·메타 줄·기사 팝업 동작 동일).
 * 아래 "모든 뉴스 보기" → /news.
 */
export async function TodayTopNews({ day, locale }: { day: NewsDay | undefined; locale: string }) {
  const t = await getTranslations({ locale, namespace: "today" });
  if (!day || !day.top.length) return null;
  const [first, ...rest] = day.top;
  const more = Math.max(0, day.total - day.top.length);
  return (
    <section aria-labelledby="today-top-h" className="space-y-4" data-testid="today-top-news">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b-2 border-ink pb-2.5">
        <h2 id="today-top-h" className="text-[22px] font-[800] tracking-[-0.02em] text-ink">
          {t("topNews")}
        </h2>
        <span className="font-mono text-[13px] text-ink-3">{t("topNewsMeta", { date: formatDateGroup(day.date, locale), total: day.total })}</span>
      </div>
      <ul className="grid gap-x-6 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
        <li className="sm:col-span-2 lg:row-span-2 [&_h2]:lg:text-[24px] [&_h2]:lg:line-clamp-none">
          <NewsCard item={first} outletCount={first.outlet_count} />
        </li>
        {rest.map((item) => (
          <li key={item.id}>
            <NewsCard item={item} outletCount={item.outlet_count} />
          </li>
        ))}
      </ul>
      <div className="flex justify-center pt-2">
        <Link
          href="/news"
          data-testid="today-all-news"
          className="inline-flex min-h-11 items-center rounded-[4px] border border-rule px-5 text-sm text-ink-2 transition-colors hover:border-ink-3 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {more > 0 ? t("allNewsMore", { count: more }) : t("allNews")}
        </Link>
      </div>
    </section>
  );
}
