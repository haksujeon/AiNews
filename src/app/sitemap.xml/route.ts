import { sitemapFileUrl, sitemapIds } from "@/lib/seo/sitemap";
import { serializeSitemapIndex } from "@/lib/seo/sitemap-xml";

// sitemap 목차(sitemapindex): /ainews/sitemap/{id}.xml 들을 가리킨다. robots.txt 의 Sitemap: 줄이 이 주소다.
export const revalidate = 3600;

export async function GET() {
  const ids = await sitemapIds();
  return new Response(serializeSitemapIndex(ids.map(sitemapFileUrl)), {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
