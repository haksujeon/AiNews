"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { apiUrl } from "@/lib/api-path";
import { extractErrorMessage } from "@/lib/api-error";

interface StoryText {
  rank: number;
  title: string;
  what: string;
  why: string;
}

interface Props {
  id: string;
  date: string;
  version: number;
  locale: string;
  canPublish: boolean;
  canWithdraw: boolean;
  edit: { headline: string; lede: string; top_stories: StoryText[] } | null;
}

interface Issue {
  rule?: string;
  path?: string;
  detail?: string;
}

const HEADLINE_MAX = 32;

/**
 * 관리자 검토 화면의 작업 버튼 + 인라인 수정 폼.
 * 발행·철회는 기존 /api/admin/briefing/publish, 다시 생성은 /api/admin/briefing/regenerate,
 * 수정 저장은 /api/admin/briefing/edit (서버에서 같은 validator 로 재검증) 를 부른다.
 */
export function BriefingReviewActions({ id, date, version, locale, canPublish, canWithdraw, edit }: Props) {
  const t = useTranslations("briefingAdmin");
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string; issues?: Issue[] } | null>(null);
  const [form, setForm] = useState(edit);

  async function call(action: string, url: string, body: unknown, confirmText?: string) {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(action);
    setMessage(null);
    try {
      const res = await fetch(apiUrl(url), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data: unknown = await res.clone().json().catch(() => null);
        const issues = (data as { error?: { issues?: unknown } } | null)?.error?.issues;
        setMessage({
          kind: "error",
          text: await extractErrorMessage(res, t("actionFailed")),
          issues: Array.isArray(issues) ? (issues as Issue[]) : undefined,
        });
        return null;
      }
      const data = (await res.json().catch(() => null)) as { data?: Record<string, unknown> } | null;
      return data?.data ?? {};
    } catch {
      setMessage({ kind: "error", text: t("actionFailed") });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function publish() {
    const r = await call("publish", "/api/admin/briefing/publish", { date, version }, t("confirmPublish", { date, version }));
    if (r) {
      setMessage({ kind: "ok", text: t("done") });
      router.refresh();
    }
  }
  async function withdraw() {
    const r = await call("withdraw", "/api/admin/briefing/publish", { date, action: "withdraw" }, t("confirmWithdraw", { date }));
    if (r) {
      setMessage({ kind: "ok", text: t("done") });
      router.refresh();
    }
  }
  async function regenerate() {
    const r = await call("regenerate", "/api/admin/briefing/regenerate", { date }, t("confirmRegenerate", { date }));
    if (r) {
      const locales = (r.locales as { locale: string; version: number; status: string; error?: string }[] | undefined) ?? [];
      const summary = locales.map((l) => `${l.locale} v${l.version} ${l.status}${l.error ? ` (${l.error})` : ""}`).join(" · ");
      setMessage({ kind: r.outcome === "failed" ? "error" : "ok", text: `${String(r.outcome ?? "")} ${summary}`.trim() });
      router.push("/admin/briefings");
      router.refresh();
    }
  }
  async function save() {
    if (!form) return;
    const r = await call("save", "/api/admin/briefing/edit", {
      id,
      headline: form.headline,
      lede: form.lede,
      top_stories: form.top_stories.map(({ title, what, why }) => ({ title, what, why })),
    });
    if (r && typeof r.id === "string") {
      setMessage({ kind: "ok", text: t("saved", { version: Number(r.version) }) });
      router.push(`/admin/briefings/${r.id}`);
    }
  }

  const field = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm leading-relaxed text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const label = "mb-1 flex justify-between text-xs font-semibold text-ink-3";

  return (
    <div className="space-y-6">
      <section aria-labelledby="actions-h">
        <h2 id="actions-h" className="mb-2 border-b border-rule-strong pb-1.5 text-sm font-bold text-ink">
          {t("actions")}
        </h2>
        <div className="flex flex-wrap gap-2">
          {locale === "ko" && (
            <Button onClick={publish} disabled={!canPublish || busy !== null} data-testid="admin-publish">
              {busy === "publish" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
              {t("publish")}
            </Button>
          )}
          <Button variant="outline" onClick={withdraw} disabled={!canWithdraw || busy !== null} data-testid="admin-withdraw">
            {busy === "withdraw" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
            {t("withdraw")}
          </Button>
          <Button variant="outline" onClick={regenerate} disabled={busy !== null} data-testid="admin-regenerate">
            {busy === "regenerate" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
            {t("regenerate")}
          </Button>
        </div>
        {busy && <p className="mt-2 text-sm text-ink-2">{t("working")}</p>}
        {message && (
          <div role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "mt-2 text-sm text-destructive" : "mt-2 text-sm text-jade"}>
            <p>{message.issues?.length ? t("validationFailed") : message.text}</p>
            {message.issues?.length ? (
              <ul className="mt-1 list-disc pl-5 text-xs">
                {message.issues.map((i, k) => (
                  <li key={k}>
                    [{i.rule}] {i.path}: {i.detail}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
      </section>

      {form ? (
        <section aria-labelledby="edit-h">
          <h2 id="edit-h" className="mb-1 border-b border-rule-strong pb-1.5 text-sm font-bold text-ink">
            {t("editTitle")}
          </h2>
          <p className="mb-3 text-xs leading-relaxed text-ink-3">{t("editHint")}</p>
          <div className="space-y-3">
            <div>
              <label htmlFor="ed-headline" className={label}>
                <span>{t("fieldHeadline")}</span>
                <span className={form.headline.length > HEADLINE_MAX ? "text-destructive" : undefined}>
                  {t("charCount", { count: form.headline.length, max: HEADLINE_MAX })}
                </span>
              </label>
              <input id="ed-headline" className={field} value={form.headline} onChange={(e) => setForm({ ...form, headline: e.target.value })} />
            </div>
            <div>
              <label htmlFor="ed-lede" className={label}>
                <span>{t("fieldLede")}</span>
                <span>{t("charCount", { count: form.lede.length, max: 200 })}</span>
              </label>
              <textarea id="ed-lede" rows={4} className={field} value={form.lede} onChange={(e) => setForm({ ...form, lede: e.target.value })} />
            </div>
            {form.top_stories.map((s, i) => (
              <fieldset key={s.rank} className="space-y-2 border-t border-rule pt-3">
                {(["title", "what", "why"] as const).map((k) => (
                  <div key={k}>
                    <label htmlFor={`ed-${i}-${k}`} className={label}>
                      <span>{t(k === "title" ? "fieldTitle" : k === "what" ? "fieldWhat" : "fieldWhy", { rank: s.rank })}</span>
                    </label>
                    {k === "title" ? (
                      <input
                        id={`ed-${i}-${k}`}
                        className={field}
                        value={s[k]}
                        onChange={(e) => {
                          const next = form.top_stories.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x));
                          setForm({ ...form, top_stories: next });
                        }}
                      />
                    ) : (
                      <textarea
                        id={`ed-${i}-${k}`}
                        rows={3}
                        className={field}
                        value={s[k]}
                        onChange={(e) => {
                          const next = form.top_stories.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x));
                          setForm({ ...form, top_stories: next });
                        }}
                      />
                    )}
                  </div>
                ))}
              </fieldset>
            ))}
            <Button onClick={save} disabled={busy !== null} data-testid="admin-save-edit">
              {busy === "save" && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
              {t("saveEdit")}
            </Button>
          </div>
        </section>
      ) : (
        locale !== "ko" && <p className="text-xs text-ink-3">{t("editOnlyKo")}</p>
      )}
    </div>
  );
}
