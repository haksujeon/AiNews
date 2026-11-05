import { NextRequest, NextResponse } from "next/server";
import { confirmSubscriber, verifyConfirmToken } from "@/lib/newsletter/signup";
import { renderWelcomeMail } from "@/lib/newsletter/signup-email";
import { getTransport } from "@/lib/newsletter/transport";

/**
 * 구독 확인 — POST 만 (확인 화면의 버튼). GET 은 메일 보안 검사기가 미리 열어 보므로 바꾸지 않는다.
 * 처음 확인이면 환영 메일을 보낸다. 환영 메일이 실패해도 구독은 된 상태로 답한다.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { t?: unknown } | null;
  const id = verifyConfirmToken(typeof body?.t === "string" ? body.t : null);
  if (!id) return NextResponse.json({ error: { code: "invalid_token", message: "링크가 올바르지 않거나 만료됐습니다." } }, { status: 400 });
  try {
    const s = await confirmSubscriber(id);
    if (!s) return NextResponse.json({ error: { code: "expired", message: "신청 정보가 없습니다. 다시 신청해 주세요." } }, { status: 410 });
    if (!s.already) {
      try {
        const m = renderWelcomeMail(s.language, s.id);
        await getTransport().send({ to: s.email, subject: m.subject, html: m.html, text: m.text, headers: m.headers });
      } catch (e) {
        console.error("[newsletter-confirm] 환영 메일 실패", (e as Error).message);
      }
    }
    return NextResponse.json({ data: { ok: true, language: s.language, already: s.already } });
  } catch (e) {
    console.error("[newsletter-confirm]", (e as Error).message);
    return NextResponse.json({ error: { code: "server_error", message: "처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요." } }, { status: 500 });
  }
}
