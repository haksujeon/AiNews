import { useTranslations } from "next-intl";
import { fxFootnoteParts, type FxLocale, type FxRates } from "@/lib/fx/convert";
import { formatShortDate } from "@/lib/briefing/view";

/**
 * 금액 환산 각주: "괄호 안 ‘약 …원’은 11월 5일 ECB 기준 환율(1달러 = 1,344.69원 · 1위안 = 201.65원)로 바꾼 참고값입니다."
 * 브리핑 페이지(briefing-view)·기사 상세(article-body)가 같은 부품 (Gate 2). 문구는 briefing.fxNote (메일은 daily-email.ts 의 같은 문구).
 */
export function FxNote({ fx, locale, className }: { fx: FxRates | null | undefined; locale: string; className?: string }) {
  const t = useTranslations("briefing");
  if (!fx) return null;
  const loc = (["ko", "en", "zh"].includes(locale) ? locale : "ko") as FxLocale;
  const rates = fxFootnoteParts(loc, fx)
    .map((p) => t("fxRate", { from: t(`fxUnit_${p.from}` as never), rate: p.rate }))
    .join(" · ");
  return (
    <span className={className} data-testid="fx-note">
      {t("fxNote", { date: formatShortDate(fx.date, loc), rates })}
    </span>
  );
}
