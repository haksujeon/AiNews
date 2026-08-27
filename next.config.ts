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
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**" },
    ],
  },
};

export default withNextIntl(nextConfig);
