import { NextRequest, NextResponse } from "next/server";

export const COOKIE_NAME = "admin_session";
export const COOKIE_MAX_AGE = 8 * 60 * 60; // 8 hours

function base64urlEncode(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (let i = 0; i < arr.length; i++) binary += String.fromCharCode(arr[i]);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function base64urlDecode(str: string): Uint8Array {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function getHmacKey(): Promise<CryptoKey> {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("ADMIN_SECRET must be at least 32 characters");
  }
  const keyMaterial = new TextEncoder().encode(secret);
  return crypto.subtle.importKey(
    "raw",
    keyMaterial,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

export async function signAdminToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = base64urlEncode(
    new TextEncoder().encode(
      JSON.stringify({ iat: now, exp: now + COOKIE_MAX_AGE })
    )
  );
  const key = await getHmacKey();
  const signatureBytes = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload)
  );
  const signature = base64urlEncode(signatureBytes);
  return `${payload}.${signature}`;
}

export async function verifyAdminToken(token: string): Promise<boolean> {
  try {
    const [payload, signature] = token.split(".");
    if (!payload || !signature) return false;

    const key = await getHmacKey();
    const sigBytes = base64urlDecode(signature);
    const isValid = await crypto.subtle.verify(
      "HMAC",
      key,
      // .buffer(ArrayBuffer)를 넘기면 미들웨어(Edge) 실행 환경에서 다른 영역의 ArrayBuffer 로 보여 verify 가 던진다
      // ("3rd argument is not instance of ArrayBuffer…", QA D-01 — 로그인 뒤 관리자 화면이 로그인으로 되돌아감). 바이트 배열을 그대로 넘긴다
      new Uint8Array(sigBytes),
      new TextEncoder().encode(payload)
    );
    if (!isValid) return false;

    const decoded = JSON.parse(
      new TextDecoder().decode(base64urlDecode(payload))
    ) as { iat: number; exp: number };

    return Math.floor(Date.now() / 1000) < decoded.exp;
  } catch (e) {
    // 이유를 남긴다 (QA D-01: 미들웨어에서만 검증이 실패했는데 원인이 로그에 없었다). 토큰 값은 남기지 않는다
    console.error("[admin-auth] 토큰 검증 오류:", (e as Error)?.message ?? String(e));
    return false;
  }
}

export async function requireAdminAuth(
  request: NextRequest
): Promise<NextResponse | null> {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token || !(await verifyAdminToken(token))) {
    return NextResponse.json(
      { error: { message: "Unauthorized" } },
      { status: 401 }
    );
  }
  return null;
}
