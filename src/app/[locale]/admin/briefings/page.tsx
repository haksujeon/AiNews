import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { AdminShell } from "@/components/admin/admin-shell";
import { listBriefingsForAdmin } from "@/lib/briefing/admin";
import { cn } from "@/lib/utils";

// 관리자 브리핑 목록 (미들웨어가 /admin/* 를 세션으로 보호한다). 항상 최신 상태를 읽는다.
export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  published: "font-semibold text-jade",
  draft: "font-semibold text-ink",
  failed: "font-semibold text-destructive",
};

export default async function AdminBriefingsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "briefingAdmin" });
  const rows = await listBriefingsForAdmin();

  return (
    <AdminShell>
      <div className="mx-auto max-w-6xl">
        <h1 className="text-xl font-bold text-ink">{t("listTitle")}</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-2">{t("listHint")}</p>
        {rows.length === 0 ? (
          <p className="py-10 text-sm text-ink-3">{t("empty")}</p>
        ) : (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm" data-testid="admin-briefings-table">
              <thead className="border-b-2 border-rule-strong text-xs text-ink-3">
                <tr>
                  <th className="py-2 pr-3 font-semibold">{t("colDate")}</th>
                  <th className="py-2 pr-3 font-semibold">{t("colLocale")}</th>
                  <th className="py-2 pr-3 font-semibold">{t("colVersion")}</th>
                  <th className="py-2 pr-3 font-semibold">{t("colStatus")}</th>
                  <th className="py-2 pr-3 text-right font-semibold">{t("colFatal")}</th>
                  <th className="py-2 pr-3 text-right font-semibold">{t("colWarn")}</th>
                  <th className="py-2 pr-3 text-right font-semibold">{t("colCost")}</th>
                  <th className="py-2 pr-3 font-semibold">{t("colReview")}</th>
                  <th className="py-2 font-semibold">{t("colHeadline")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-rule align-top">
                    <td className="whitespace-nowrap py-2 pr-3">
                      <Link href={`/admin/briefings/${r.id}`} className="font-medium text-ink underline decoration-rule underline-offset-4 hover:decoration-ink">
                        {r.edition_date}
                      </Link>
                    </td>
                    <td className="py-2 pr-3 uppercase text-ink-2">{r.locale}</td>
                    <td className="py-2 pr-3 text-ink-2">v{r.version}</td>
                    <td className={cn("whitespace-nowrap py-2 pr-3", STATUS_STYLE[r.status] ?? "text-ink-3")}>
                      {t(`status_${r.status}` as never)}
                    </td>
                    <td className={cn("py-2 pr-3 text-right", r.fatal ? "font-semibold text-destructive" : "text-ink-3")}>{r.fatal}</td>
                    <td className="py-2 pr-3 text-right text-ink-3">{r.warn}</td>
                    <td className="py-2 pr-3 text-right text-ink-3">{r.cost_usd ? `$${Number(r.cost_usd).toFixed(4)}` : "—"}</td>
                    <td className="py-2 pr-3">{r.needs_review ? <span className="font-semibold text-destructive">●</span> : ""}</td>
                    <td className="py-2">
                      {r.headline && <span className="text-ink">{r.headline}</span>}
                      {r.error && <p className="mt-0.5 break-all text-xs text-destructive">{r.error}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </AdminShell>
  );
}
