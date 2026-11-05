"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { apiUrl } from "@/lib/api-path";
import { cn } from "@/lib/utils";

type Lang = "ko" | "zh" | "en";
const LANGS: { code: Lang; label: string }[] = [
  { code: "ko", label: "한국어" },
  { code: "zh", label: "中文" },
  { code: "en", label: "English" },
];

/**
 * 구독 신청서 (QR·사이트 "구독" 버튼으로 열림). 회사·이름·이메일·언어 필수, 직책 선택 (사용자 결정 2026-11-05).
 * 제출하면 확인 메일을 보냈다는 안내만 — 이미 구독 중인지는 드러내지 않는다 (API 와 같은 규칙).
 * 숨은 칸(website)·화면 연 시각(t0)으로 봇을 거른다.
 */
export function SubscribeForm({ defaultLang, source }: { defaultLang: Lang; source: string | null }) {
  const t = useTranslations("subscribe");
  const [t0] = useState(() => Date.now());
  const [lang, setLang] = useState<Lang>(defaultLang);
  const [state, setState] = useState<"idle" | "busy" | "sent" | "error">("idle");
  const [error, setError] = useState("");
  const [bad, setBad] = useState<string[]>([]);
  const [email, setEmail] = useState("");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body = {
      organization: String(f.get("organization") ?? ""),
      name: String(f.get("name") ?? ""),
      jobTitle: String(f.get("jobTitle") ?? ""),
      email: String(f.get("email") ?? ""),
      language: lang,
      consent: f.get("consent") === "on",
      age14: f.get("age14") === "on",
      website: String(f.get("website") ?? ""),
      source,
      t0,
    };
    setState("busy");
    setBad([]);
    try {
      const res = await fetch(apiUrl("/api/newsletter/subscribe"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setEmail(body.email.trim());
        setState("sent");
        return;
      }
      const data = await res.json().catch(() => ({}));
      const fields = Array.isArray(data?.error?.fields) ? (data.error.fields as string[]) : [];
      setBad(fields);
      setError(fields.length ? t("fixFields") : typeof data.error === "string" ? data.error : data.error?.message ?? t("failed"));
      setState("error");
    } catch {
      setError(t("failed"));
      setState("error");
    }
  }

  if (state === "sent")
    return (
      <div role="status" className="grid gap-3 border-l-[3px] border-jade bg-jade-weak px-5 py-5" data-testid="subscribe-sent">
        <p className="text-[19px] font-[750] text-ink">{t("sentTitle")}</p>
        <p className="text-[15px] leading-[1.75] text-ink-2">{t("sentBody", { email })}</p>
        <p className="text-[13px] text-ink-3">{t("sentSpam")}</p>
        <Link href="/briefing" className="mt-1 text-[15px] font-semibold text-jade underline underline-offset-4">
          {t("whileWaiting")} →
        </Link>
      </div>
    );

  const field = "grid gap-1.5";
  const label = "text-[14px] font-[650] text-ink";
  const input = (name: string) =>
    cn(
      "min-h-11 w-full rounded-[4px] border bg-paper px-3 text-[16px] text-ink placeholder:text-ink-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      bad.includes(name) ? "border-red-600 dark:border-red-400" : "border-rule"
    );
  const errText = (name: string, key: string) =>
    bad.includes(name) && (
      <span className="text-[13px] text-red-700 dark:text-red-400" id={`${name}-err`}>
        {t(key)}
      </span>
    );

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-5" data-testid="subscribe-form">
      <div className={field}>
        <label htmlFor="sub-org" className={label}>
          {t("organization")}
        </label>
        <input id="sub-org" name="organization" autoComplete="organization" required maxLength={100} placeholder={t("organizationPh")} className={input("organization")} aria-invalid={bad.includes("organization") || undefined} aria-describedby={bad.includes("organization") ? "organization-err" : undefined} />
        {errText("organization", "errRequired")}
      </div>
      <div className={field}>
        <label htmlFor="sub-name" className={label}>
          {t("name")}
        </label>
        <input id="sub-name" name="name" autoComplete="name" required maxLength={60} className={input("name")} aria-invalid={bad.includes("name") || undefined} aria-describedby={bad.includes("name") ? "name-err" : undefined} />
        {errText("name", "errRequired")}
      </div>
      <div className={field}>
        <label htmlFor="sub-job" className={label}>
          {t("jobTitle")} <span className="font-normal text-ink-3">{t("optional")}</span>
        </label>
        <input id="sub-job" name="jobTitle" autoComplete="organization-title" maxLength={60} placeholder={t("jobTitlePh")} className={input("jobTitle")} />
      </div>
      <fieldset className={field}>
        <legend className={cn(label, "mb-1.5")}>{t("language")}</legend>
        <div className="grid grid-cols-3 overflow-hidden rounded-[4px] border border-rule">
          {LANGS.map((l) => (
            <label
              key={l.code}
              className={cn(
                "flex min-h-11 cursor-pointer items-center justify-center border-r border-rule text-[15px] last:border-r-0 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-inset has-[:focus-visible]:ring-ring",
                lang === l.code ? "bg-jade font-bold text-paper" : "text-ink-2 hover:bg-surface"
              )}
            >
              <input type="radio" name="language" value={l.code} checked={lang === l.code} onChange={() => setLang(l.code)} className="sr-only" />
              {l.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className={field}>
        <label htmlFor="sub-email" className={label}>
          {t("email")}
        </label>
        <input id="sub-email" name="email" type="email" inputMode="email" autoComplete="email" required maxLength={254} placeholder="name@company.com" className={input("email")} aria-invalid={bad.includes("email") || undefined} aria-describedby={bad.includes("email") ? "email-err" : undefined} />
        {errText("email", "errEmail")}
      </div>

      {/* 봇만 채우는 숨은 칸 — 사람에게는 보이지 않고 낭독기·탭 이동에서도 빠진다 */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <div className="grid gap-3 border-t border-rule pt-4">
        <label className="flex cursor-pointer items-start gap-3 text-[14px] leading-[1.6] text-ink-2">
          <input type="checkbox" name="consent" className="mt-1 h-[18px] w-[18px] shrink-0 accent-[var(--jade)]" aria-invalid={bad.includes("consent") || undefined} />
          <span>
            <b className="text-ink">{t("consentRequired")}</b> {t("consentText")}{" "}
            <Link href="/privacy" className="text-jade underline underline-offset-4" target="_blank">
              {t("privacyLink")}
            </Link>
          </span>
        </label>
        {errText("consent", "errConsent")}
        <label className="flex cursor-pointer items-start gap-3 text-[14px] leading-[1.6] text-ink-2">
          <input type="checkbox" name="age14" className="mt-1 h-[18px] w-[18px] shrink-0 accent-[var(--jade)]" aria-invalid={bad.includes("age") || undefined} />
          <span>{t("age14")}</span>
        </label>
        {errText("age", "errAge")}
      </div>

      <button
        type="submit"
        disabled={state === "busy"}
        className="inline-flex min-h-12 items-center justify-center rounded-[4px] bg-jade px-6 text-[16px] font-bold text-paper hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60"
        data-testid="subscribe-submit"
      >
        {state === "busy" ? t("busy") : t("submit")}
      </button>
      {state === "error" && (
        <p role="alert" className="text-[14px] text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
      <p className="text-[13px] text-ink-3">{t("unsubNote")}</p>
    </form>
  );
}
