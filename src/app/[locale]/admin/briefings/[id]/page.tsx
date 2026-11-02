import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { AdminShell } from "@/components/admin/admin-shell";
import { BriefingReviewActions } from "@/components/admin/briefing-review-actions";
import { BriefingAiReview } from "@/components/admin/briefing-ai-review";
import { reviewThatProduced, reviewsOf } from "@/lib/briefing/review/store";
import { BriefingView } from "@/components/briefing/briefing-view";
import { PeriodicView } from "@/components/briefing/periodic-view";
import { getBriefingRow, translationsOf } from "@/lib/briefing/admin";
import { getBriefingForReview } from "@/lib/briefing/public";
import { getPeriodicForReview, periodKeyOf } from "@/lib/briefing/periodic/public";
import type { StoredWeeklyContent } from "@/lib/briefing/periodic/types";
import type { StoredBriefingContent, ValidationIssue } from "@/lib/briefing/types";

// 관리자 브리핑 상세: 검증 결과 + AI 검토 결과(자동 발행 판정) + 작업 + 인라인 수정 + 공개 페이지와 같은 컴포넌트(BriefingView / 주간·월간은 PeriodicView)로 그린 미리보기.
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function IssueList({ title, items, tone }: { title: string; items: ValidationIssue[]; tone: "fatal" | "warn" }) {
  if (!items.length) return null;
  return (
    <div className="mt-2">
      <p className={tone === "fatal" ? "text-xs font-semibold text-destructive" : "text-xs font-semibold text-ink-2"}>
        {title} ({items.length})
      </p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs leading-relaxed text-ink-2">
        {items.map((i, k) => (
          <li key={k}>
            <span className="font-mono">[{i.rule}]</span> {i.path}: {i.detail}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default async function AdminBriefingDetailPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const row = await getBriefingRow(id);
  if (!row) notFound();
  const t = await getTranslations({ locale, namespace: "briefingAdmin" });
  // 주간·월간(periodic)은 같은 미리보기·작업을 쓴다
  const weekly = row.edition_type === "weekly" || row.edition_type === "monthly";
  const monthly = row.edition_type === "monthly";
  const [preview, weeklyPreview, translations, aiReviews, producedBy] = await Promise.all([
    weekly ? null : getBriefingForReview(id),
    weekly ? getPeriodicForReview(id) : null,
    row.locale === "ko" && !weekly ? translationsOf(id) : [],
    row.locale === "ko" ? reviewsOf(id).catch(() => []) : [],
    row.locale === "ko" ? reviewThatProduced(id).catch(() => null) : null,
  ]);

  const v = (row.validation ?? {}) as {
    final?: { fatal?: ValidationIssue[]; warn?: ValidationIssue[] };
    problems?: string[];
    dropped_items?: string[];
    fallbacks?: string[];
    used?: string;
    ai_review_fix?: Parameters<typeof BriefingAiReview>[0]["fixInfo"];
  };
  const fatal = v.final?.fatal ?? [];
  const warn = v.final?.warn ?? [];
  const problems = v.problems ?? [];
  const content = row.content as unknown as Partial<StoredBriefingContent>;
  const editable = !weekly && row.locale === "ko" && !!content.top_stories?.length && ["draft", "published", "superseded"].includes(row.status);
  const week = weekly ? periodKeyOf(monthly ? "monthly" : "weekly", content as unknown as Partial<StoredWeeklyContent>, row.edition_date) : "";
  // 데일리도 같은 결손일 판정을 meta.data_quality 에 남긴다 (데일리는 알림만, 발행 확인은 주간·월간)
  const dqDays = (content as unknown as Partial<StoredWeeklyContent>).meta?.data_quality?.incomplete_days ?? [];

  return (
    <AdminShell>
      <div className="mx-auto max-w-6xl">
        <Link href="/admin/briefings" className="text-sm text-ink-2 hover:text-ink">
          {t("backToList")}
        </Link>
        <h1 className="mt-2 text-xl font-bold text-ink" data-testid="admin-briefing-title">
          {monthly
            ? t("detailTitleMonthly", { month: week, locale: row.locale.toUpperCase(), version: row.version })
            : weekly
            ? t("detailTitleWeekly", { week, locale: row.locale.toUpperCase(), version: row.version })
            : t("detailTitle", { date: row.edition_date, locale: row.locale.toUpperCase(), version: row.version })}
        </h1>
        <p className="mt-1 text-xs text-ink-3">
          {t("meta", {
            status: t(`status_${row.status}` as never),
            model: row.model ?? "—",
            prompt: row.prompt_version ?? "—",
            cost: row.cost_usd ? Number(row.cost_usd).toFixed(6) : "0",
            inTok: row.input_tokens ?? 0,
            outTok: row.output_tokens ?? 0,
          })}
        </p>

        <div className="mt-5 grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="min-w-0 space-y-5 lg:order-2">
            {row.error && (
              <section role="alert" className="border-l-[3px] border-destructive px-3 py-2">
                <h2 className="text-xs font-semibold text-destructive">{t("errorTitle")}</h2>
                <p className="mt-0.5 break-all text-sm text-ink" data-testid="admin-briefing-error">
                  {row.error}
                </p>
              </section>
            )}
            {dqDays.length > 0 && (
              <section role="note" className="border-l-[3px] border-ink-3 bg-surface px-3 py-2" data-testid="admin-data-quality">
                <h2 className="text-xs font-semibold text-ink">{t("dataQualityTitle")}</h2>
                <p className="mt-0.5 text-sm leading-relaxed text-ink-2">{t("dataQualityBody", { days: dqDays.join(", ") })}</p>
              </section>
            )}
            <section>
              <h2 className="border-b border-rule-strong pb-1.5 text-sm font-bold text-ink">{t("validationTitle")}</h2>
              {!fatal.length && !warn.length && !problems.length ? (
                <p className="mt-2 text-xs text-ink-3">{t("noIssues")}</p>
              ) : (
                <>
                  <IssueList title={t("colFatal")} items={fatal} tone="fatal" />
                  <IssueList title={t("colWarn")} items={warn} tone="warn" />
                  <IssueList
                    title={t("colFatal")}
                    items={problems.map((p) => ({ level: "fatal", rule: "translation", path: "", detail: p }))}
                    tone="fatal"
                  />
                </>
              )}
              {v.dropped_items?.length ? <p className="mt-2 text-xs text-ink-3">{t("droppedItems", { items: v.dropped_items.join(", ") })}</p> : null}
              {v.fallbacks?.length ? <p className="mt-1 text-xs text-ink-3">{t("fallbacks", { items: v.fallbacks.join(", ") })}</p> : null}
            </section>
            {row.locale === "ko" && (
              <BriefingAiReview
                locale={locale}
                briefingId={row.id}
                reviews={aiReviews}
                producedBy={producedBy}
                fixInfo={v.ai_review_fix ?? null}
                canReview={["draft", "published"].includes(row.status) && Boolean(row.content && Object.keys(row.content).length)}
              />
            )}
            {row.locale === "ko" && !weekly && (
              <section>
                <h2 className="border-b border-rule-strong pb-1.5 text-sm font-bold text-ink">{t("translations")}</h2>
                {translations.length ? (
                  <ul className="mt-2 space-y-1 text-sm">
                    {translations.map((tr) => (
                      <li key={tr.id}>
                        <Link href={`/admin/briefings/${tr.id}`} className="text-ink underline decoration-rule underline-offset-4">
                          {tr.locale.toUpperCase()} v{tr.version}
                        </Link>{" "}
                        <span className="text-ink-3">{t(`status_${tr.status}` as never)}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-xs leading-relaxed text-destructive">{t("noTranslations")}</p>
                )}
              </section>
            )}
            <BriefingReviewActions
              id={row.id}
              date={row.edition_date}
              version={row.version}
              locale={row.locale}
              canPublish={row.locale === "ko" && row.status === "draft" && !fatal.length}
              canWithdraw={row.status === "published"}
              editionType={monthly ? "monthly" : weekly ? "weekly" : "daily"}
              week={week || undefined}
              dataQualityDays={dqDays}
              edit={
                editable
                  ? {
                      headline: content.headline ?? "",
                      lede: content.lede ?? "",
                      top_stories: (content.top_stories ?? []).map((s) => ({ rank: s.rank, title: s.title, what: s.what, why: s.why })),
                    }
                  : null
              }
            />
          </div>

          <section className="min-w-0 lg:order-1" aria-label={t("preview")}>
            <p className="border-b border-rule pb-1.5 text-xs font-semibold text-ink-3">{monthly ? t("previewMonthly") : weekly ? t("previewWeekly") : t("preview")}</p>
            {weekly ? (
              weeklyPreview ? (
                <PeriodicView report={weeklyPreview} />
              ) : (
                <p className="py-8 text-sm text-ink-3">{t("notRenderable")}</p>
              )
            ) : preview ? (
              <BriefingView briefing={preview} />
            ) : (
              <p className="py-8 text-sm text-ink-3">{t("notRenderable")}</p>
            )}
          </section>
        </div>
      </div>
    </AdminShell>
  );
}
