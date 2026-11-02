import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { isLocale } from "@/i18n/routing";
import { getPublishedBriefing } from "@/lib/briefing/public";
import { bannerState } from "@/lib/briefing/sla";
import { BRIEFING_PATH, formatShortDate } from "@/lib/briefing/view";

/**
 * 홈 상단 한 줄 띠 "오늘의 중국 AI 브리핑 · {headline} →".
 * 언제나 가장 최근 발행본을 보여 준다. 마감(sla.ts)이 지난 최근 판이 아직 발행되지 않았으면
 * "최신 브리핑 · {날짜} 판" 날짜 칩을 단다. 발행본이 한 번도 없을 때만 숨긴다 (판정은 sla.ts bannerState).
 * 헤더 메뉴와 같은 경로·같은 읽기 함수를 쓴다 (Gate 2). DB 오류가 나도 홈을 깨뜨리지 않고 띠만 숨긴다.
 */
export async function BriefingBanner({ locale }: { locale: string }) {
  if (!isLocale(locale)) return null;
  const briefing = await getPublishedBriefing(locale).catch((e) => {
    console.warn("[briefing-banner]", e);
    return null;
  });
  const state = bannerState(briefing?.edition_date ?? null, new Date());
  if (!briefing || !state.show) return null;
  const t = await getTranslations({ locale, namespace: "briefing" });
  const headline = briefing.content.headline;
  const date = formatShortDate(briefing.edition_date, locale);

  return (
    <Link
      href={BRIEFING_PATH}
      data-testid="briefing-banner"
      data-dated={state.dated ? "true" : "false"}
      aria-label={state.dated ? t("bannerAriaDated", { headline, date }) : t("bannerAria", { headline })}
      className="group mb-6 flex min-w-0 items-baseline gap-x-2.5 border-b border-rule pb-3 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="shrink-0 font-[650] text-jade">{state.dated ? t("bannerLabelLatest") : t("bannerLabel")}</span>
      {state.dated && (
        <span
          data-testid="briefing-banner-date"
          className="shrink-0 rounded-sm border border-rule px-1.5 text-xs font-medium leading-5 text-ink-2"
        >
          {t("bannerDated", { date })}
        </span>
      )}
      <span aria-hidden="true" className="shrink-0 text-ink-3">
        ·
      </span>
      <span className="min-w-0 truncate font-medium text-ink group-hover:underline group-hover:decoration-1 group-hover:underline-offset-4">
        {headline}
      </span>
      <span aria-hidden="true" className="shrink-0 text-ink-2">
        →
      </span>
    </Link>
  );
}
