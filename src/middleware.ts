import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import { NextRequest, NextResponse } from "next/server";
import { verifyAdminToken } from "./lib/admin-auth";

const intlMiddleware = createMiddleware(routing);

const ADMIN_PATTERN = /^\/(?:ko|en|zh)\/admin(?:\/(?!login).*)?$/;
const ADMIN_LOGIN_PATTERN = /^\/(?:ko|en|zh)\/admin\/login$/;

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    pathname.includes(".")
  ) {
    return;
  }

  // Admin auth check (excluding login page)
  if (ADMIN_PATTERN.test(pathname) && !ADMIN_LOGIN_PATTERN.test(pathname)) {
    const sessionCookie = request.cookies.get("admin_session")?.value;
    const isValid = sessionCookie
      ? await verifyAdminToken(sessionCookie)
      : false;

    if (!isValid) {
      const locale = pathname.split("/")[1];
      const loginUrl = new URL(`/${locale}/admin/login`, request.url);
      return NextResponse.redirect(loginUrl);
    }
  }

  return intlMiddleware(request);
}

export const config = {
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};
