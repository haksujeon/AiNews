"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { apiUrl } from "@/lib/api-path";
import { extractErrorMessage } from "@/lib/api-error";

/** 관리자 "AI 다시 검토" — /api/admin/briefing/review (검토·판정 기록만, 발행은 하지 않는다) */
export function BriefingRereviewButton({ id }: { id: string }) {
  const t = useTranslations("briefingAdmin");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function run() {
    if (!window.confirm(t("aiReviewConfirm"))) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(apiUrl("/api/admin/briefing/review"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        setMessage({ kind: "error", text: await extractErrorMessage(res, t("actionFailed")) });
        return;
      }
      const data = (await res.json().catch(() => null)) as { data?: { verdict?: unknown; score?: unknown; decision?: unknown } } | null;
      const d = data?.data ?? {};
      setMessage({
        kind: "ok",
        text: t("aiReviewDone", {
          verdict: typeof d.verdict === "string" ? d.verdict : "—",
          score: typeof d.score === "number" ? d.score : "—",
          decision: typeof d.decision === "string" ? d.decision : "",
        }),
      });
      router.refresh();
    } catch {
      setMessage({ kind: "error", text: t("actionFailed") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3">
      <Button variant="outline" size="sm" onClick={run} disabled={busy} data-testid="admin-ai-rereview">
        {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
        {busy ? t("aiReviewRunning") : t("aiReviewRerun")}
      </Button>
      {message && (
        <p role="status" className={message.kind === "error" ? "mt-1.5 text-xs text-destructive" : "mt-1.5 text-xs text-ink-2"}>
          {message.text}
        </p>
      )}
    </div>
  );
}
