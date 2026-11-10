"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { apiUrl } from "@/lib/api-path";

/** /unsubscribe 화면의 버튼 — 메일 프로그램의 한 번 누르기와 같은 API(POST) 를 부른다 */
export function UnsubscribeButton({ token }: { token: string }) {
  const t = useTranslations("unsubscribe");
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [error, setError] = useState("");

  async function onClick() {
    setState("busy");
    try {
      const res = await fetch(apiUrl("/api/newsletter/unsubscribe"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ t: token }),
      });
      if (res.ok) return setState("done");
      // 서버 문구(한국어 고정) 대신 화면 언어 문구 (QA C-15): 링크 문제(400·410)와 그 밖의 실패를 나눈다
      setError(res.status === 400 || res.status === 410 ? t("invalid") : t("failed"));
      setState("error");
    } catch {
      setError(t("failed"));
      setState("error");
    }
  }

  if (state === "done")
    return (
      <p role="status" className="rounded-[4px] border border-jade/30 bg-jade-weak px-4 py-3 text-[15px] leading-relaxed text-ink" data-testid="unsubscribe-done">
        {t("done")}
      </p>
    );
  return (
    <div className="grid gap-3">
      <button
        type="button"
        onClick={onClick}
        disabled={state === "busy"}
        data-testid="unsubscribe-button"
        className="inline-flex min-h-11 items-center justify-center rounded-[4px] bg-ink px-5 text-[15px] font-bold text-background hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 sm:w-fit"
      >
        {state === "busy" ? t("busy") : t("button")}
      </button>
      {state === "error" && (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
