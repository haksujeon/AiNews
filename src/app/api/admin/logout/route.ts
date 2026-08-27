import { NextResponse } from "next/server";
import { COOKIE_NAME } from "@/lib/admin-auth";

export async function POST() {
  const response = NextResponse.json({ data: { ok: true } });
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    path: "/",
    maxAge: 0,
  });
  return response;
}
