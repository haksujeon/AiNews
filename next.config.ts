import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

// basePath는 <Link>/router/next-image/정적자원에만 자동 적용된다.
// 클라이언트 fetch()는 자동 prefix되지 않으므로 NEXT_PUBLIC_BASE_PATH로 노출해
// src/lib/api-path.ts 의 apiUrl()에서 직접 붙인다.
const BASE_PATH = "/ainews";

const nextConfig: NextConfig = {
  basePath: BASE_PATH,
  env: {
    NEXT_PUBLIC_BASE_PATH: BASE_PATH,
  },
  // 신뢰 페이지 본문(content/legal/*.md)은 fs 로 읽으므로 standalone 산출물에 넣는다 (Dockerfile)
  outputFileTracingIncludes: {
    "/[locale]/about": ["./content/legal/**/*"],
    "/[locale]/methodology": ["./content/legal/**/*"],
    "/[locale]/corrections": ["./content/legal/**/*"],
    "/[locale]/privacy": ["./content/legal/**/*"],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
};

export default withNextIntl(nextConfig);
