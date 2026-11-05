import { NextRequest, NextResponse } from "next/server";
import { looksLikeBot, parseSignup, purgeExpiredPending, rateLimited, upsertPending } from "@/lib/newsletter/signup";
import { renderConfirmMail } from "@/lib/newsletter/signup-email";
import { getTransport } from "@/lib/newsletter/transport";

/**
 * 구독 신청 (POST, JSON). 확인 대기로 저장하고 확인 메일을 보낸다 (signup.ts).
 * 답은 언제나 같다 — 이미 구독 중인 주소인지 드러내지 않는다. 틀린 칸만 400 으로 알려 준다.
 * 봇(숨은 칸·너무 빠른 제출)·같은 접속 주소 1시간 5건 초과는 조용히 같은 답(저장·발송 없음).
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") return NextResponse.json({ error: { code: "bad_request", message: "요청 형식이 올바르지 않습니다." } }, { status: 400 });

  const parsed = parseSignup(body);
  if (!parsed.ok) return NextResponse.json({ error: { code: "invalid_fields", message: "입력을 확인해 주세요.", fields: parsed.fields } }, { status: 400 });

  const ip = (request.headers.get("x-forwarded-for")?.split(",")[0] ?? request.headers.get("x-real-ip") ?? "").trim() || null;
  const ok = NextResponse.json({ data: { ok: true } });
  if (looksLikeBot(body)) return ok;
  if (ip && rateLimited(ip)) return ok;

  try {
    await purgeExpiredPending();
    const r = await upsertPending(parsed.input, ip);
    if (r.kind === "pending") {
      const m = renderConfirmMail(r.language, r.id, r.name);
      await getTransport().send({ to: parsed.input.email, subject: m.subject, html: m.html, text: m.text });
    }
    return ok;
  } catch (e) {
    console.error("[newsletter-subscribe]", (e as Error).message);
    return NextResponse.json({ error: { code: "server_error", message: "신청을 처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요." } }, { status: 500 });
  }
}
