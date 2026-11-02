import { sitemapEntries, sitemapIds } from "@/lib/seo/sitemap";
import { serializeUrlset } from "@/lib/seo/sitemap-xml";

/*
 * /ainews/sitemap/{id}.xml — 0: 정적 페이지·브리핑, 1..N: 공개 기사 5,000건씩(언어 3개 URL + hreflang).
 * 목차는 /ainews/sitemap.xml (src/app/sitemap.xml/route.ts).
 * Next 의 sitemap.ts(generateSitemaps)와 같은 방식으로 나누되, XSD 순서를 지키려고 직렬화는 직접 한다(sitemap-xml.ts).
 * 빌드 때 지금 있는 파일들을 만들고 한 시간마다 다시 만든다. 기사가 늘어 생긴 새 번호는 첫 요청 때 만든다.
 */
export const revalidate = 3600;

export async function generateStaticParams() {
  return (await sitemapIds()).map((id) => ({ file: `${id}.xml` }));
}

export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  const m = /^(\d{1,4})\.xml$/.exec(file);
  const id = m ? Number(m[1]) : -1;
  if (id < 0 || !(await sitemapIds()).includes(id)) {
    return new Response("Not Found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  }
  return new Response(serializeUrlset(await sitemapEntries(id)), {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  });
}
