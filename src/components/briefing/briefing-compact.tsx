import { useTranslations } from "next-intl";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { formatDateGroup } from "@/lib/news-utils";
import type { PublicBriefing } from "@/lib/briefing/public";
import { formatShortDate } from "@/lib/briefing/view";
import { LOCALE_HTML_LANG, type Locale } from "@/i18n/routing";
import { AiLabel, BriefingCoverage, DataNotice, Sources, TopStoryItem } from "./briefing-view";
import { BriefingDateLink } from "./briefing-date-link";

/*
 * 홈 날짜 팝업의 간추린 브리핑 (설계 §2 "팝업에 들어갈 내용").
 * 브리핑 페이지(BriefingView)와 같은 부품(BriefingCoverage·AiLabel·DataNotice·TopStoryItem·Sources)으로 그린다 (Gate 2).
 * 전체 BriefingView 를 넣지 않는 이유: lg: 기준이 화면 폭이라 760px 팝업 안에서도 오른쪽 칸이 켜지고,
 * 자체 h1·이전/다음 판·가로 띠·#story 앵커가 팝업과 맞지 않는다. "왜 중요한가"·그 밖의 소식·레일은 전체 브리핑에서.
 * 팝업에는 h1·JSON-LD 가 없다(색인되는 것은 전체 페이지 하나).
 */

/** 머리 줄(스크롤해도 붙어 있음): 키커 + 판 날짜 / 주말 합본이면 기간 */
export function BriefingCompactHeader({ briefing }: { briefing: Pick<PublicBriefing, "edition_date" | "period_end" | "locale"> }) {
  const t = useTranslations("briefing");
  const loc = briefing.locale;
  const weekend = briefing.period_end > briefing.edition_date;
  return (
    <p className="text-[13px] text-ink-3" data-testid="briefing-compact-date">
      <span className="mr-2.5 font-[650] text-jade max-sm:block max-sm:mr-0">{t("kicker")}</span>
      <time dateTime={briefing.edition_date}>
        {weekend
          ? t("weekendRange", { start: formatShortDate(briefing.edition_date, loc), end: formatShortDate(briefing.period_end, loc) })
          : formatDateGroup(briefing.edition_date, loc)}
      </time>
    </p>
  );
}

export function BriefingCompact({ briefing }: { briefing: PublicBriefing }) {
  const t = useTranslations("briefing");
  const c = briefing.content;
  const htmlLang = LOCALE_HTML_LANG[briefing.locale as Locale] ?? briefing.locale;

  return (
    <div lang={htmlLang} className="px-4 pb-[calc(24px+env(safe-area-inset-bottom))] pt-4 sm:px-8 sm:pb-8 sm:pt-6" data-testid="briefing-compact">
      <p className="flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-ink-3">
        <BriefingCoverage briefing={briefing} />
      </p>
      <DialogTitle className="mt-2.5 text-[23px] font-[740] leading-[1.28] tracking-[-0.028em] text-ink sm:text-[28px]">{c.headline}</DialogTitle>
      <DialogDescription asChild>
        <p className="mt-3 text-base font-medium leading-[1.75] text-ink-2 sm:text-[17px]">{c.lede}</p>
      </DialogDescription>
      <Sources refs={c.lede_refs} briefing={briefing} className="mt-2" />
      <AiLabel className="mt-3" />
      <DataNotice briefing={briefing} className="mt-[18px]" />

      {c.top_stories.length > 0 && (
        <section className="mt-2">
          <h3 className="flex items-baseline justify-between border-b border-rule-strong pb-2.5 pt-6 text-[17px] font-bold text-ink">
            {t("topStories")}
            <span className="text-[13px] font-normal text-ink-3">{t("byImportance")}</span>
          </h3>
          <ol>
            {c.top_stories.map((s) => (
              <TopStoryItem key={s.rank} story={s} briefing={briefing} variant="compact" titleTag="h4" />
            ))}
          </ol>
        </section>
      )}

      <div className="pt-5">
        <BriefingDateLink
          date={briefing.edition_date}
          data-testid="briefing-compact-full"
          className="inline-flex min-h-11 items-center justify-center rounded-[4px] border border-rule-strong px-[18px] text-[15px] font-[650] text-ink hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:w-full"
        >
          {t("compactReadFull")}
          <span aria-hidden="true" className="ml-1.5">
            →
          </span>
        </BriefingDateLink>
      </div>
    </div>
  );
}
