"use client";

import { useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { Link } from "@/i18n/navigation";

const KEY = "ainews-intro-dismissed";

/**
 * "오늘" 홈 맨 위의 첫 방문자용 소개 띠 (2026-11-03 결정 A: 랜딩은 /about, 홈에는 닫을 수 있는 띠).
 * 닫으면 이 브라우저에 기억한다(localStorage — 막혀 있으면 띠만 다시 보일 뿐 동작은 그대로).
 * 서버 렌더에서는 그리지 않고 마운트 뒤에 보인다 (재방문자에게 깜박이지 않게).
 */
function subscribe(cb: () => void) {
  window.addEventListener("storage", cb);
  return () => window.removeEventListener("storage", cb);
}
function readDismissed(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function IntroStrip() {
  const t = useTranslations("landing");
  // 서버 스냅숏은 "닫힘" → 서버 렌더·첫 하이드레이션에서는 그리지 않는다
  const stored = useSyncExternalStore(subscribe, readDismissed, () => "1");
  const [closed, setClosed] = useState(false);
  if (stored === "1" || closed) return null;
  const dismiss = () => {
    setClosed(true);
    try {
      window.localStorage.setItem(KEY, "1");
    } catch {
      /* 저장 실패는 무시 */
    }
  };
  return (
    <div className="border-b border-rule bg-jade-weak" data-testid="intro-strip">
      <div className="container mx-auto flex min-h-11 items-center gap-3 px-4 text-[14px]">
        <span className="text-ink">{t("introStrip")}</span>
        <Link href="/about" className="font-semibold text-jade underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {t("introLink")} →
        </Link>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t("introClose")}
          className="ml-auto flex h-11 w-11 items-center justify-center text-ink-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
