import type { MetadataRoute } from "next";
import { rootUrl } from "@/lib/site";
import { BASE_PATH } from "@/lib/api-path";

/*
 * 앱이 /ainews/robots.txt 를 내고, nginx 가 도메인 루트 /robots.txt 를 이 주소로 넘긴다(결정 D2,
 * docs/nginx-robots.conf). 도메인 루트에서 읽히므로 경로에 basePath(/ainews)를 붙인다.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: `${BASE_PATH}/`,
      disallow: [`${BASE_PATH}/api/`, `${BASE_PATH}/*/admin`],
    },
    sitemap: rootUrl("/sitemap.xml"),
  };
}
