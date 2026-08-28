import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { signAdminToken, COOKIE_NAME, COOKIE_MAX_AGE } from "@/lib/admin-auth";
import { rateLimit, resetRateLimit, clientIp } from "@/lib/rate-limit";

// 단일 공유 비밀번호 하나로 보호되는 엔드포인트이므로 시도 횟수를 제한한다.
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15분

const sha256 = (value: string): Buffer =>
  createHash("sha256").update(value, "utf8").digest();

export async function POST(request: NextRequest) {
  const key = `admin-auth:${clientIp(request)}`;
  const limit = rateLimit(key, MAX_ATTEMPTS, WINDOW_MS);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: { message: "Too many attempts. Try again later." } },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } }
    );
  }

  const body = await request.json().catch(() => ({}));
  const { password } = body;

  if (!password || typeof password !== "string") {
    return NextResponse.json(
      { error: { message: "Password is required" } },
      { status: 400 }
    );
  }

  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    console.error("[api/admin/auth] ADMIN_PASSWORD 미설정 — 로그인을 거부합니다.");
    return NextResponse.json(
      { error: { message: "Admin login is not configured" } },
      { status: 503 }
    );
  }

  // 상수시간 비교. 양쪽을 해시해 길이 노출도 피한다.
  if (!timingSafeEqual(sha256(password), sha256(expected))) {
    return NextResponse.json(
      { error: { message: "Invalid password" } },
      { status: 401 }
    );
  }

  resetRateLimit(key);
  const token = await signAdminToken();
  const response = NextResponse.json({ data: { ok: true } });
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });

  return response;
}
