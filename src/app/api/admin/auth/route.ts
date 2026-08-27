import { NextRequest, NextResponse } from "next/server";
import { signAdminToken, COOKIE_NAME, COOKIE_MAX_AGE } from "@/lib/admin-auth";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { password } = body;

  if (!password) {
    return NextResponse.json(
      { error: { message: "Password is required" } },
      { status: 400 }
    );
  }

  if (password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json(
      { error: { message: "Invalid password" } },
      { status: 401 }
    );
  }

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
