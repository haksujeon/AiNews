import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/admin-auth";
import { PublishError, normalizeWithdrawReason, publishBriefing, withdrawBriefing } from "@/lib/briefing/publish";
import { isValidEditionDate } from "@/lib/briefing/generate";
import { BRIEFING_LOCALES, type BriefingLocale } from "@/lib/briefing/types";
import { isEditionType } from "@/lib/briefing/repository";
import { easyRunNote, ensureEasyTerms } from "@/lib/briefing/easy-terms-run";
import { ensurePeriodicTranslations, periodicTranslateNote } from "@/lib/briefing/periodic/translate-run";

// POST /api/admin/briefing/publish  (관리자 세션 쿠키 필요)
// body: { date: 'YYYY-MM-DD', version?: number, action?: 'publish' | 'withdraw', locale?: 'ko'|'en'|'zh',
//         edition_type?: 'daily'|'weekly'|'monthly' (기본 daily, 주간·월간은 date = period_start),
//         acknowledgeDataQuality?: boolean (주간·월간: 수집 미완 날짜가 있는 판은 true 여야 발행),
//         reason?: string (withdraw 에 필수 — 공개 정정 메모 public_note 로 저장, 최대 500자) }
//  - publish: 그 날짜 ko 초안(version 미지정 시 최신 draft)과 거기서 번역된 en/zh 초안을 발행.
//             기존 발행본은 superseded 로 바뀐다.
//             데일리면 이어서 "쉬운 AI 설명"을 만든다 (AI 검토 자동 발행과 같은 ensureEasyTerms, 실패해도 발행은 그대로 — data.easyTerms 에 한 줄)
//  - withdraw: 발행본 철회 (locale 미지정 시 모든 언어판). 사유가 없으면 400
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authError = await requireAdminAuth(request);
  if (authError) return authError;

  const body: unknown = await request.json().catch(() => ({}));
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const date = typeof b.date === "string" ? b.date : "";
  if (!isValidEditionDate(date)) {
    return NextResponse.json({ error: { message: "date must be YYYY-MM-DD" } }, { status: 400 });
  }
  const action = b.action === "withdraw" ? "withdraw" : "publish";
  const version = typeof b.version === "number" && Number.isInteger(b.version) && b.version > 0 ? b.version : undefined;
  const locale = BRIEFING_LOCALES.includes(b.locale as BriefingLocale) ? (b.locale as BriefingLocale) : undefined;
  if (b.edition_type !== undefined && !isEditionType(b.edition_type)) {
    return NextResponse.json({ error: { message: "edition_type must be daily, weekly or monthly" } }, { status: 400 });
  }
  const editionType = isEditionType(b.edition_type) ? b.edition_type : "daily";

  try {
    if (action === "withdraw") {
      const reason = normalizeWithdrawReason(b.reason);
      if (!reason) return NextResponse.json({ error: { message: "withdraw requires a reason (2-500 chars)" } }, { status: 400 });
      const withdrawn = await withdrawBriefing({ date, reason, locale, editedBy: "admin", editionType });
      return NextResponse.json({ data: { date, withdrawn } });
    }
    const result = await publishBriefing({
      date,
      version,
      editedBy: "admin",
      editionType,
      acknowledgeDataQuality: b.acknowledgeDataQuality === true,
    });
    let easyTerms = "";
    // 주간·월간: 영어·중국어판 (AI 검토 자동 발행과 같은 ensurePeriodicTranslations, 실패해도 발행은 그대로 — data.translations 에 한 줄)
    let translations = "";
    if (editionType !== "daily" && result.published.some((p) => p.locale === "ko")) {
      const ko = result.published.find((p) => p.locale === "ko")!;
      translations = await ensurePeriodicTranslations(ko.id)
        .then(periodicTranslateNote)
        .catch((e: unknown) => `번역 실패: ${(e as Error).message}`);
    }
    if (editionType === "daily" && result.published.some((p) => p.locale === "ko")) {
      easyTerms = await ensureEasyTerms({ date })
        .then((r) => easyRunNote(r) || r.detail)
        .catch((e: unknown) => `쉬운 AI 설명 실패: ${(e as Error).message}`);
    }
    return NextResponse.json({ data: { ...result, easyTerms, translations } });
  } catch (e) {
    if (e instanceof PublishError) {
      return NextResponse.json({ error: { message: e.message } }, { status: e.status });
    }
    console.error("[api/admin/briefing/publish]", e);
    return NextResponse.json({ error: { message: "Publish failed" } }, { status: 500 });
  }
}
