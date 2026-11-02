import { getTranslations } from "next-intl/server";
import type { BriefingSlaStatus } from "@/lib/briefing/sla";
import { cn } from "@/lib/utils";

type SlaState = "published" | "overdue" | "review" | "failed" | "pending" | "skipped";

/** 상태 → 띠에 쓸 한 단어. 알림(n8n)은 같은 status 의 overdue/notify 를 본다 */
export function slaState(s: BriefingSlaStatus): SlaState {
  if (s.published) return "published";
  if (s.overdue) return "overdue";
  if (s.koStatus === "skipped" && !s.generated) return "skipped";
  if (s.generated) return "review";
  if (s.koStatus === "failed") return "failed";
  return "pending";
}

const STATE_STYLE: Record<SlaState, string> = {
  published: "text-jade",
  overdue: "text-destructive",
  review: "text-ink",
  failed: "text-destructive",
  pending: "text-ink-2",
  skipped: "text-ink-2",
};

/**
 * 관리자 브리핑 목록 맨 위 SLA 띠: 현재 판의 상태(마감 포함)와 최근 14일 발행률.
 * 값은 GET /api/internal/briefing/status 와 같은 briefingSlaStatus() 결과다 (Gate 2).
 */
export async function BriefingSlaStrip({ status, locale }: { status: BriefingSlaStatus; locale: string }) {
  const t = await getTranslations({ locale, namespace: "briefingAdmin" });
  const state = slaState(status);
  const r = status.rate14d;
  const pct = r.rate === null ? null : Math.round(r.rate * 100);

  return (
    <section
      aria-labelledby="sla-h"
      data-testid="admin-sla-strip"
      data-sla-state={state}
      className="mt-4 border-y border-rule-strong py-3"
    >
      <h2 id="sla-h" className="sr-only">
        {t("slaTitle")}
      </h2>
      <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
        <div className="min-w-0">
          <dt className="text-xs font-semibold text-ink-3">{t("slaEdition")}</dt>
          <dd className="mt-0.5 text-ink">
            <span className="font-semibold">{status.editionDate}</span>
            {status.weekend && (
              <span className="ml-1.5 text-xs text-ink-2">
                {t("slaWeekend")} ({status.periodStart} ~ {status.periodEnd})
              </span>
            )}
            <span className="block text-xs text-ink-3">{t("slaDue", { due: status.dueAtKst })}</span>
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs font-semibold text-ink-3">{t("colStatus")}</dt>
          <dd className={cn("mt-0.5 font-semibold", STATE_STYLE[state])} data-testid="admin-sla-state">
            {t(`slaState_${state}` as never)}
            <span className="block text-xs font-normal text-ink-3">
              {status.lastPublished ? t("slaLastPublished", { date: status.lastPublished.editionDate }) : t("slaNeverPublished")}
            </span>
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs font-semibold text-ink-3">{t("slaRate")}</dt>
          <dd className={cn("mt-0.5 font-semibold", pct !== null && pct < 90 ? "text-destructive" : "text-ink")} data-testid="admin-sla-rate">
            {pct === null ? t("slaRateNone") : t("slaRateValue", { published: r.published, eligible: r.eligible, pct })}
            {pct !== null && <span className="block text-xs font-normal text-ink-3">{t("slaOnTime", { onTime: r.onTime })}</span>}
          </dd>
        </div>
      </dl>
      <p className="mt-2 text-xs leading-relaxed text-ink-3">{t("slaRule")}</p>
    </section>
  );
}
