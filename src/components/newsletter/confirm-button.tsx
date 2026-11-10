"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { apiUrl } from "@/lib/api-path";

/** 구독 확인 화면의 버튼 — POST /api/newsletter/confirm (GET 으로는 구독되지 않는다) */
export function ConfirmButton({ token }: { token: string }) {
  const t = useTranslations("subscribe");
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [error, setError] = useState("");

  async function onClick() {
    setState("busy");
    try {
      const res = await fetch(apiUrl("/api/newsletter/confirm"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ t: token }),
      });
      if (res.ok) return setState("done");
      // 서버 문구(한국어 고정) 대신 화면 언어 문구 (QA C-15): 링크 문제(400·410)와 그 밖의 실패를 나눈다
      setError(res.status === 400 || res.status === 410 ? t("confirmInvalid") : t("failed"));
      setState("error");
    } catch {
      setError(t("failed"));
      setState("error");
    }
  }

  if (state === "done")
    return (
      <div role="status" className="grid gap-3 border-l-[3px] border-jade bg-jade-weak px-5 py-5" data-testid="subscribe-confirmed">
        <p className="text-[19px] font-[750] text-ink">{t("doneTitle")}</p>
        <p className="text-[15px] leading-[1.75] text-ink-2">{t("doneBody")}</p>
        <Link href="/briefing" className="inline-flex min-h-11 w-fit items-center rounded-[4px] bg-jade px-5 text-[15px] font-bold text-paper hover:opacity-90">
          {t("doneCta")}
        </Link>
      </div>
    );
  return (
    <div className="grid gap-3">
      <button
        type="button"
        onClick={onClick}
        disabled={state === "busy"}
        data-testid="subscribe-confirm-button"
        className="inline-flex min-h-12 items-center justify-center rounded-[4px] bg-jade px-6 text-[16px] font-bold text-paper hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60 sm:w-fit"
      >
        {state === "busy" ? t("busy") : t("confirmButton")}
      </button>
      {state === "error" && (
        <p role="alert" className="text-[14px] text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
