"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Loader2, RotateCw } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { apiUrl } from "@/lib/api-path";
import type { PublicBriefing } from "@/lib/briefing/public";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RouteModalShell, rememberFocusOrigin } from "@/components/layout/route-modal-shell";
import { BriefingCompact, BriefingCompactHeader } from "@/components/briefing/briefing-compact";

/*
 * 홈 날짜 → 그날 브리핑 팝업 (구현 방식 (b): 클라이언트 대화상자 + ?briefing=YYYY-MM-DD).
 *
 * 왜 가로채기 라우트(@modal/(.)briefing/[date])가 아닌가 — 사전 검증 실패(2026-11-02, Next 16.1.6):
 * 가로채기 rewrite 의 출처 패턴이 /:locale/briefing/:date 라 정적 형제 경로 /briefing/archive·weekly·monthly 까지
 * 잡았다(홈에서 소프트 이동, 브리핑 탭 클릭 모두 팝업 슬롯으로 빨려 들어가 페이지가 바뀌지 않음).
 *
 * 동작:
 *  - 날짜 옆 링크(day-briefing-link.tsx)는 실제 주소 /briefing/DATE 를 가진 <a>. 보통 클릭만 가로채 ?briefing= 을 pushState 한다
 *    (서버 요청 없음 → 펼침·무한 스크롤 상태 그대로). 새 탭·복사·JS 없음은 전체 페이지로 간다.
 *  - 뒤로가기 = 팝업 닫힘, 앞으로가기 = 다시 열림. Esc·바깥 누르기·닫기 버튼은 우리가 넣은 기록이면 history.back(),
 *    새로고침·공유로 바로 들어온 주소면 replaceState 로 매개변수만 지운다(뒤로가기로 사이트를 떠나지 않게).
 *  - 새로고침·공유하면 홈 + 팝업으로 다시 열린다 (전체 페이지는 /briefing/DATE).
 *  - 데이터는 /api/briefing/day (getPublishedBriefing, no-store) — 철회되면 정정 안내.
 *  - 틀·바닥 시트·포커스 되돌리기는 기사 팝업과 같은 RouteModalShell.
 */

export const DAY_BRIEFING_PARAM = "briefing";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 이 탭에서 우리가 pushState 로 넣은 기록 위에 있는가 (닫을 때 back 할지 replace 할지) */
let pushedByUs = false;

export const dayBriefingFocusKey = (day: string) => `day-briefing-${day}`;

/** 날짜 옆 링크의 보통 클릭 → 팝업 열기 */
export function openDayBriefing(editionDate: string, dayDate: string) {
  rememberFocusOrigin(`[data-focus-key="${dayBriefingFocusKey(dayDate)}"]`);
  const url = new URL(window.location.href);
  url.searchParams.set(DAY_BRIEFING_PARAM, editionDate);
  window.history.pushState(null, "", url);
  pushedByUs = true;
}

function closeDayBriefing() {
  if (pushedByUs) {
    pushedByUs = false;
    window.history.back();
    return;
  }
  const url = new URL(window.location.href);
  url.searchParams.delete(DAY_BRIEFING_PARAM);
  window.history.replaceState(null, "", url);
}

type Loaded = { status: "ok"; briefing: PublicBriefing } | { status: "withdrawn" | "not_found" | "error" };

// 한 페이지 동안 받은 판은 다시 받지 않는다 (뒤로·앞으로 때 높이가 튀지 않게). 실패는 담지 않는다.
const cache = new Map<string, Loaded>();

async function loadBriefing(locale: string, date: string): Promise<Loaded> {
  const key = `${locale}:${date}`;
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const res = await fetch(apiUrl(`/api/briefing/day?locale=${encodeURIComponent(locale)}&date=${encodeURIComponent(date)}`), { cache: "no-store" });
    const body = await res.json().catch(() => null);
    let out: Loaded;
    if (res.ok && body?.data?.content) out = { status: "ok", briefing: body.data as PublicBriefing };
    else if (res.status === 404) out = { status: body?.error?.code === "withdrawn" ? "withdrawn" : "not_found" };
    else return { status: "error" };
    cache.set(key, out);
    return out;
  } catch {
    return { status: "error" };
  }
}

/** 판 날짜만 알 때(불러오는 중)의 머리 줄 정보: 토요일 판 = 토·일 합본 (sla.ts editionPeriod 와 같은 규칙) */
function periodHint(date: string, locale: string): Pick<PublicBriefing, "edition_date" | "period_end" | "locale"> {
  const d = new Date(`${date}T00:00:00Z`);
  const end = d.getUTCDay() === 6 ? new Date(d.getTime() + 86_400_000).toISOString().slice(0, 10) : date;
  return { edition_date: date, period_end: end, locale: locale as PublicBriefing["locale"] };
}

export function DayBriefingDialog() {
  const t = useTranslations("briefing");
  const tc = useTranslations("common");
  const locale = useLocale();
  const params = useSearchParams();
  const raw = params.get(DAY_BRIEFING_PARAM);
  const date = raw && DATE_RE.test(raw) ? raw : null;
  const [result, setResult] = useState<{ key: string; loaded: Loaded } | null>(null);
  const [retry, setRetry] = useState(0);
  const key = date ? `${locale}:${date}:${retry}` : null;

  useEffect(() => {
    if (!date || !key) return;
    let cancelled = false;
    void loadBriefing(locale, date).then((loaded) => {
      if (!cancelled) setResult({ key, loaded });
    });
    return () => {
      cancelled = true;
    };
  }, [date, locale, key]);

  // 닫히는 동안(애니메이션)에는 마지막 내용을 그대로 둔다
  const loaded: Loaded | null = result && (!key || result.key === key) ? result.loaded : null;
  const shownDate = date ?? (loaded?.status === "ok" ? loaded.briefing.edition_date : null);
  const header =
    loaded?.status === "ok" ? loaded.briefing : shownDate ? periodHint(shownDate, locale) : null;

  let body: React.ReactNode;
  if (loaded?.status === "ok") {
    body = <BriefingCompact briefing={loaded.briefing} />;
  } else if (loaded) {
    const withdrawn = loaded.status === "withdrawn";
    body = (
      <div className="px-4 py-10 sm:px-8" data-testid={withdrawn ? "briefing-withdrawn" : loaded.status === "error" ? "briefing-compact-error" : "briefing-compact-missing"} role={loaded.status === "error" ? "alert" : undefined}>
        <DialogTitle className="text-lg font-bold text-ink">
          {withdrawn ? t("withdrawnInModal") : loaded.status === "error" ? t("compactError") : t("compactNotFound")}
        </DialogTitle>
        <DialogDescription asChild>
          <div className="mt-4 text-[15px]">
            {withdrawn ? (
              <Link
                href="/corrections"
                className="rounded-sm text-jade underline decoration-1 underline-offset-4 hover:decoration-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {t("withdrawnLink")}
                <span aria-hidden="true"> →</span>
              </Link>
            ) : loaded.status === "error" ? (
              <Button variant="outline" size="sm" onClick={() => setRetry((n) => n + 1)}>
                <RotateCw className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                {tc("retry")}
              </Button>
            ) : null}
          </div>
        </DialogDescription>
      </div>
    );
  } else {
    // 불러오는 중: 본문 자리를 미리 잡아 도착할 때 상자가 덜 튀게 한다
    body = (
      <div className="flex min-h-[50vh] items-center justify-center gap-2 text-sm text-ink-3" role="status" data-testid="briefing-compact-loading">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        <DialogTitle className="text-sm font-normal text-ink-3">{t("compactLoading")}</DialogTitle>
        <DialogDescription className="sr-only">{t("compactLoading")}</DialogDescription>
      </div>
    );
  }

  return (
    <RouteModalShell
      open={Boolean(date)}
      onOpenChange={(open) => {
        if (!open) closeDayBriefing();
      }}
      stickyHeader={header ? <BriefingCompactHeader briefing={header} /> : null}
      data-testid="day-briefing-dialog"
    >
      {body}
    </RouteModalShell>
  );
}
