import { NextRequest, NextResponse } from "next/server";
import { verifyUnsubscribeToken } from "@/lib/newsletter/token";
import { unsubscribe } from "@/lib/newsletter/send";

/**
 * 수신 거부 — POST 만 (GET 은 메일 보안 검사기가 미리 열어 보므로 바꾸지 않는다).
 * 두 곳에서 부른다: 메일 프로그램의 한 번 누르기(RFC 8058, List-Unsubscribe-Post) 와 /unsubscribe 화면의 버튼. 같은 함수(Gate 2).
 * 토큰은 ?t= 또는 JSON body { t }.
 */
export async function POST(request: NextRequest) {
  let token = request.nextUrl.searchParams.get("t");
  if (!token && request.headers.get("content-type")?.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as { t?: unknown } | null;
    token = typeof body?.t === "string" ? body.t : null;
  }
  const id = verifyUnsubscribeToken(token);
  if (!id) return NextResponse.json({ error: { code: "invalid_token", message: "링크가 올바르지 않습니다." } }, { status: 400 });
  try {
    await unsubscribe(id);
    return NextResponse.json({ data: { ok: true } });
  } catch (e) {
    console.error("[newsletter-unsubscribe]", (e as Error).message);
    return NextResponse.json({ error: { code: "server_error", message: "처리하지 못했습니다. 잠시 뒤 다시 시도해 주세요." } }, { status: 500 });
  }
}
