import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { isLocale } from "@/i18n/routing";
import { getPublishedBriefing } from "@/lib/briefing/public";
import { BRIEFING_PATH } from "@/lib/briefing/view";

/**
 * 홈 상단 한 줄 띠 "오늘의 중국 AI 브리핑 · {headline} →".
 * 발행된 판이 있을 때만 그린다. 헤더 메뉴와 같은 경로·같은 읽기 함수를 쓴다 (Gate 2).
 * DB 오류가 나도 홈을 깨뜨리지 않고 띠만 숨긴다.
 */
export async function BriefingBanner({ locale }: { locale: string }) {
  if (!isLocale(locale)) return null;
  const briefing = await getPublishedBriefing(locale).catch((e) => {
    console.warn("[briefing-banner]", e);
    return null;
  });
  if (!briefing) return null;
  const t = await getTranslations({ locale, namespace: "briefing" });
  const headline = briefing.content.headline;

  return (
    <Link
      href={BRIEFING_PATH}
      data-testid="briefing-banner"
      aria-label={t("bannerAria", { headline })}
      className="group mb-6 flex min-w-0 items-baseline gap-x-2.5 border-b border-rule pb-3 text-[15px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="shrink-0 font-[650] text-jade">{t("bannerLabel")}</span>
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
