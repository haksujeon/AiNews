import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { PublicBriefing } from "@/lib/briefing/public";
import { bannerState } from "@/lib/briefing/sla";
import { BRIEFING_PATH, briefingDatePath, formatShortDate, readMinutes } from "@/lib/briefing/view";
import { Sources } from "@/components/briefing/briefing-view";
import { TodayStories } from "./today-stories";
import { ListenLink } from "@/components/briefing/briefing-media";
import { SubscribeLink } from "@/components/newsletter/subscribe-link";

/**
 * "오늘" 홈의 브리핑 카드(옆 칸과 같은 밝은 바탕 — 2026-11-11 화이트 테마에서 검은 카드만 튀던 것) + 옆 칸(숫자로 보는 오늘·주목할 기업·오늘의 용어).
 * 데이터는 브리핑 페이지·홈 띠와 같은 getPublishedBriefing(최신 발행본, 숨긴 기사 근거는 이미 빠짐 — pruneToVisible) (Gate 2).
 * 최신 발행본이 마감 지난 옛 판이면 "최신 브리핑 · N월 N일 판"으로 날짜를 밝힌다 (bannerState, 홈 띠와 같은 판정).
 * 그 언어판 발행본이 없으면 빈 카드 대신 안내(언제 만들고 어떻게 발행하는지) + 지난 브리핑 링크.
 */
export async function TodayBriefing({ briefing, locale }: { briefing: PublicBriefing | null; locale: string }) {
  const t = await getTranslations({ locale, namespace: "today" });
  const tb = await getTranslations({ locale, namespace: "briefing" });

  if (!briefing) {
    return (
      <section aria-labelledby="today-brief-h" className="rounded-md border border-rule border-t-4 border-t-ink bg-background px-6 py-7 text-ink sm:px-8" data-testid="today-briefing-empty">
        <p className="font-mono text-xs font-semibold text-jade">DAILY BRIEFING</p>
        <h2 id="today-brief-h" className="mt-2 text-[22px] font-[760] leading-tight sm:text-[26px]">
          {tb("emptyTitle")}
        </h2>
        <p className="mt-2 max-w-xl text-[15px] leading-[1.7] text-ink-2">{t("noBriefingBody")}</p>
        <Link href="/news" className="mt-5 inline-flex min-h-11 items-center rounded-[4px] bg-jade px-4 text-[15px] font-bold text-paper hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
          {t("allNews")}
        </Link>
      </section>
    );
  }

  const c = briefing.content;
  const state = bannerState(briefing.edition_date, new Date());
  const dated = state.show && state.dated;
  const date = formatShortDate(briefing.edition_date, locale);

  return (
    <div className="grid gap-5 lg:grid-cols-12">
      <section
        aria-labelledby="today-brief-h"
        className="min-w-0 rounded-md border border-rule border-t-4 border-t-ink bg-background px-5 py-6 text-ink sm:px-8 sm:py-7 lg:col-span-8"
        data-testid="today-briefing"
      >
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="rounded-[3px] bg-jade px-2 py-0.5 font-mono text-[11.5px] font-bold text-paper">
            {dated ? tb("bannerLabelLatest") : tb("kicker")}
          </span>
          <span className="font-mono text-[13px] text-ink-3">
            {date} · {t("coverage", { total: c.meta?.candidate_count ?? 0, cited: c.meta?.cited_count ?? Object.keys(briefing.articles).length })} ·{" "}
            {tb("readTime", { minutes: readMinutes(c, briefing.locale) })}
          </span>
        </p>
        <h2 id="today-brief-h" className="mt-4 text-[26px] font-[800] leading-[1.22] tracking-[-0.02em] sm:text-[36px]">
          <Link href={briefingDatePath(briefing.edition_date)} className="rounded-sm hover:underline hover:decoration-2 hover:underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {c.headline}
          </Link>
        </h2>
        <p className="mt-3 max-w-[42rem] text-[16px] leading-[1.75] text-ink-2 sm:text-[17px]">{c.lede}</p>
        <Sources refs={c.lede_refs} briefing={briefing} className="mt-2 text-ink-3" />
        <div className="mt-5">
          <TodayStories briefing={briefing} />
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link
            href={briefingDatePath(briefing.edition_date)}
            className="inline-flex min-h-11 items-center rounded-[4px] bg-jade px-4 text-[15px] font-bold text-paper hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {tb("compactReadFull")}
          </Link>
          <ListenLink date={briefing.edition_date} audio={briefing.media?.audio} />
          {/* 구독 신청 (2026-11-05, 권장 2순위) */}
          <SubscribeLink source="home" variant="outline" />
          <Link
            href={`${BRIEFING_PATH}/archive`}
            className="inline-flex min-h-11 items-center rounded-[4px] border border-rule px-4 text-[15px] text-ink hover:border-ink-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {tb("archiveLink")}
          </Link>
        </div>
        <p className="mt-4 text-[12px] leading-relaxed text-ink-3">{t("aiNote")}</p>
      </section>

      <aside className="flex min-w-0 flex-col gap-5 lg:col-span-4" aria-label={t("sideLabel")}>
        {c.key_numbers.length > 0 && (
          <section className="rounded-md border border-rule bg-background p-5">
            <h2 className="mb-3 font-mono text-xs font-semibold text-ink-3">{tb("keyNumbers")}</h2>
            <ul className="grid grid-cols-2 gap-3">
              {c.key_numbers.slice(0, 4).map((k, i) => (
                <li key={i} className="border-t-2 border-ink pt-2">
                  <p className="text-[21px] font-[760] leading-tight tracking-[-0.02em] text-ink">{k.value}</p>
                  <p className="mt-1 text-[12.5px] leading-snug text-ink-2">{k.label}</p>
                </li>
              ))}
            </ul>
          </section>
        )}
        {c.companies_to_watch.length > 0 && (
          <section className="rounded-md border border-rule bg-background p-5">
            <h2 className="mb-3 font-mono text-xs font-semibold text-ink-3">{tb("companies")}</h2>
            <ul className="space-y-2.5">
              {c.companies_to_watch.map((co, i) => (
                <li key={i} className="grid grid-cols-[minmax(84px,auto)_minmax(0,1fr)] items-baseline gap-3">
                  <span className="text-[15px] font-bold text-ink">{co.name}</span>
                  <span className="text-[13px] leading-snug text-ink-2">{co.why}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {c.term_of_the_day && (
          <section className="rounded-md border border-jade/30 bg-jade-weak p-5">
            <h2 className="mb-1.5 font-mono text-xs font-semibold text-jade">{tb("term")}</h2>
            {c.term_of_the_day.pinyin && <p className="font-mono text-xs text-jade">{c.term_of_the_day.pinyin}</p>}
            <p lang="zh-CN" className="font-han text-[28px] font-bold leading-tight text-ink">
              {c.term_of_the_day.term}
            </p>
            {c.term_of_the_day.explanation && <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{c.term_of_the_day.explanation}</p>}
          </section>
        )}
      </aside>
    </div>
  );
}
