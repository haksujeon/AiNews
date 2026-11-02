import { getTranslations } from "next-intl/server";
import type { StoredReview } from "@/lib/briefing/review/store";
import type { GenLog } from "@/lib/briefing/review/evidence";
import { cn } from "@/lib/utils";
import { BriefingRereviewButton } from "./briefing-rereview-button";

/**
 * 관리자 상세: AI 검토 결과 (결정 D8 변경 — 별도 모델 검토 + 통과 시 자동 발행).
 * 최신 검토의 점수·판정·자동 발행 판정(조건별 통과 여부), 주장 표(문제 먼저), 수정안, 누락, 번역 문제, 검토 이력.
 * 이 버전이 AI 수정으로 만들어졌으면 어디서 왔는지와 바꾼 문장을 보여 준다.
 */
interface Props {
  locale: string;
  briefingId: string;
  reviews: StoredReview[];
  producedBy: StoredReview | null;
  fixInfo: { from?: { id: string; version: number }; planned?: { path: string; action: string; original: string; text: string; basis: string }[]; dropped?: string[]; fallbacks?: string[] } | null;
  canReview: boolean;
  /** 생성기 기록 (대체 판·부분 수리·삭제/수정·경고) — 검토 모델에도 같은 내용을 준다 */
  genLog?: GenLog | null;
}

const LABEL_TONE: Record<string, string> = {
  wrong: "text-destructive font-semibold",
  "number-unit": "text-destructive font-semibold",
  misattributed: "text-destructive",
  unsupported: "text-destructive",
  overclaim: "text-ink",
  correct: "text-ink-3",
};

export async function BriefingAiReview({ locale, briefingId, reviews, producedBy, fixInfo, canReview, genLog }: Props) {
  const t = await getTranslations({ locale, namespace: "briefingAdmin" });
  const latest = reviews.find((r) => r.status === "done") ?? reviews[0] ?? null;
  const claims = latest?.claims ?? [];
  const problems = claims.filter((c) => c.label !== "correct");
  const correct = claims.filter((c) => c.label === "correct");
  const checks = (latest?.decision?.checks ?? []) as { rule: string; ok: boolean; detail: string }[];
  const action = latest?.decision?.action as string | undefined;

  return (
    <section data-testid="admin-ai-review">
      <h2 className="border-b border-rule-strong pb-1.5 text-sm font-bold text-ink">{t("aiReviewTitle")}</h2>
      {producedBy && fixInfo?.from && (
        <div className="mt-2 border-l-[3px] border-ink-3 px-3 py-1.5 text-xs leading-relaxed text-ink-2" data-testid="admin-ai-fixed-from">
          <p>{t("aiReviewFixedFrom", { version: fixInfo.from.version, n: fixInfo.planned?.length ?? 0 })}</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {(fixInfo.planned ?? []).map((p, i) => (
              <li key={i}>
                <span className="font-mono">{p.path}</span> {p.action === "replace" ? t("aiReviewReplaced") : t("aiReviewDeleted")}: “{p.original}”
                {p.action === "replace" && <> → “{p.text}”</>}
              </li>
            ))}
          </ul>
          {fixInfo.dropped?.length ? <p className="mt-1">{t("droppedItems", { items: fixInfo.dropped.join(", ") })}</p> : null}
          {fixInfo.fallbacks?.length ? <p>{t("fallbacks", { items: fixInfo.fallbacks.join(", ") })}</p> : null}
        </div>
      )}
      {!latest ? (
        <p className="mt-2 text-xs text-ink-3">{t("aiReviewNone")}</p>
      ) : latest.status !== "done" ? (
        <p className="mt-2 text-xs text-destructive">{t("aiReviewError", { error: latest.error ?? "—" })}</p>
      ) : (
        <>
          <p className="mt-2 text-sm text-ink" data-testid="admin-ai-verdict">
            <span className={cn("font-bold", latest.verdict === "PASS" ? "text-ink" : "text-destructive")}>{latest.verdict}</span>{" "}
            {t("aiReviewScore", { score: latest.score ?? "—" })}
            {latest.llm_verdict && latest.llm_verdict !== latest.verdict ? <span className="text-ink-3"> ({t("aiReviewModelVerdict", { v: latest.llm_verdict })})</span> : null}
          </p>
          <p className="mt-0.5 text-xs text-ink-3">
            {t("aiReviewMeta", {
              model: latest.model,
              prompt: latest.prompt_version,
              trigger: latest.trigger,
              round: latest.round,
              cost: latest.cost_usd ? Number(latest.cost_usd).toFixed(4) : "0",
              at: new Date(latest.created_at).toISOString().slice(0, 16).replace("T", " "),
            })}
          </p>
          {latest.summary && <p className="mt-1 text-xs leading-relaxed text-ink-2">{latest.summary}</p>}
          {latest.counts && (
            <p className="mt-1 text-xs text-ink-2">
              {(["wrong", "number-unit", "misattributed", "unsupported", "overclaim", "correct"] as const).map((l) => `${l} ${latest.counts?.[l] ?? 0}`).join(" · ")}
            </p>
          )}

          {latest.decision && (
            <div className="mt-3" data-testid="admin-ai-decision">
              <p className="text-xs font-semibold text-ink">
                {t("aiReviewDecision")}: {latest.decision.summary as string}
                {action ? <span className="font-mono text-ink-3"> [{action}]</span> : null}
              </p>
              {checks.length > 0 && (
                <ul className="mt-1 space-y-0.5 text-xs text-ink-2">
                  {checks.map((c) => (
                    <li key={c.rule}>
                      <span className={c.ok ? "text-ink-3" : "font-semibold text-destructive"}>{c.ok ? "✓" : "✗"}</span> {c.detail}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="mt-3">
            <p className="text-xs font-semibold text-ink">{t("aiReviewClaims", { problems: problems.length, total: claims.length })}</p>
            {problems.length > 0 && (
              <div className="mt-1 overflow-x-auto">
                <table className="w-full text-left text-xs" data-testid="admin-ai-claims">
                  <thead className="text-ink-3">
                    <tr>
                      <th className="py-1 pr-2 font-medium">{t("aiReviewColPath")}</th>
                      <th className="py-1 pr-2 font-medium">{t("aiReviewColLabel")}</th>
                      <th className="py-1 font-medium">{t("aiReviewColClaim")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {problems.map((c, i) => (
                      <tr key={i} className="border-t border-rule align-top">
                        <td className="py-1 pr-2 font-mono text-ink-3">{c.path}</td>
                        <td className={cn("py-1 pr-2", LABEL_TONE[c.label])}>{c.label}</td>
                        <td className="py-1 leading-relaxed text-ink-2">
                          {c.claim}
                          {c.note && <span className="block text-ink-3">{c.note}</span>}
                          {c.evidence && (
                            <span className="block text-ink-3">
                              {t("aiReviewEvidence")}: “{c.evidence}”{c.evidence_verified === false ? ` (${t("aiReviewUnverified")})` : ""}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {correct.length > 0 && (
              <details className="mt-1 text-xs text-ink-3">
                <summary className="cursor-pointer">{t("aiReviewCorrect", { n: correct.length })}</summary>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {correct.map((c, i) => (
                    <li key={i}>
                      <span className="font-mono">{c.path}</span> {c.claim}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>

          {(latest.fixes ?? []).length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-ink">{t("aiReviewFixes")}</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs leading-relaxed text-ink-2">
                {(latest.fixes ?? []).map((f, i) => (
                  <li key={i}>
                    <span className="font-mono">{f.path}</span> {f.action === "replace" ? `→ “${f.text}”` : t("aiReviewDeleted")}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(latest.omissions ?? []).some((o) => o.important) && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-ink">{t("aiReviewOmissions")}</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-ink-2">
                {(latest.omissions ?? []).filter((o) => o.important).map((o) => (
                  <li key={o.cid}>
                    {o.title} <span className="text-ink-3">— {o.why}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(latest.translation ?? []).length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-ink">{t("aiReviewTranslation")}</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-ink-2">
                {(latest.translation ?? []).map((x, i) => (
                  <li key={i}>
                    <span className={x.severity === "major" ? "font-semibold text-destructive" : "text-ink-3"}>{x.locale} {x.severity}</span>{" "}
                    <span className="font-mono">{x.path}</span> {x.issue}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(latest.structure ?? []).length > 0 && (
            <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-ink-3">
              {(latest.structure ?? []).map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ul>
          )}
        </>
      )}
      {reviews.length > 1 && (
        <details className="mt-3 text-xs text-ink-3">
          <summary className="cursor-pointer">{t("aiReviewHistory", { n: reviews.length })}</summary>
          <ul className="mt-1 space-y-0.5">
            {reviews.map((r) => (
              <li key={r.id}>
                {new Date(r.created_at).toISOString().slice(0, 16).replace("T", " ")} · {r.trigger} · r{r.round} · {r.status === "done" ? `${r.verdict} ${r.score}` : `error`}
                {r.decision?.action ? ` · ${String(r.decision.action)}` : ""} · {r.prompt_version}
              </li>
            ))}
          </ul>
        </details>
      )}
      {genLog && (genLog.fallback || genLog.edits.length > 0 || genLog.warns.length > 0) && (
        <details className="mt-3 text-xs text-ink-2" data-testid="admin-gen-log">
          <summary className="cursor-pointer text-ink-3">{t("aiReviewGenLog", { n: genLog.edits.length + genLog.warns.length })}</summary>
          {genLog.fallback && <p className="mt-1 font-semibold text-destructive">{t("aiReviewGenFallback", { mode: genLog.fallback, reason: genLog.fallbackReason ?? "" })}</p>}
          {genLog.targetedRepair && <p className="mt-1">{t("aiReviewGenTargeted")}</p>}
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {genLog.warns.map((w, i) => (
              <li key={`w${i}`}>
                <span className="font-mono">[{w.rule}]</span> {w.path}: {w.detail}
              </li>
            ))}
            {genLog.edits.map((e, i) => (
              <li key={`e${i}`}>
                <span className="font-mono">{e.action}</span> {e.path} <span className="text-ink-3">({e.round})</span> {e.reason}
                {e.before ? <span className="block text-ink-3">“{e.before}”{e.after ? ` → “${e.after}”` : ""}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      )}
      {canReview && <BriefingRereviewButton id={briefingId} />}
    </section>
  );
}
