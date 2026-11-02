/** JSON-LD(src/lib/seo/jsonld.ts) 단위 테스트 — 실행: npm run test:unit (schema-dts 없이 필수 키를 직접 단정) */
import "./env";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  breadcrumbLd,
  HEADLINE_MAX,
  newsArticleLd,
  ogImagePath,
  ORGANIZATION_ID,
  organizationLd,
  safeJsonLd,
  siteJsonLd,
} from "../../src/lib/seo/jsonld";
import { briefingJsonLd, safeJsonLd as viewSafeJsonLd } from "../../src/lib/briefing/view";
import type { PublicBriefing } from "../../src/lib/briefing/public";

const ORIGIN = "https://news.aibaseclub.com/ainews";
const ID = "60574b12-9f06-4df5-948b-30ba1c0bbe5c";

function article(over: Partial<Parameters<typeof newsArticleLd>[0]> = {}) {
  return newsArticleLd({
    locale: "ko",
    path: `/news/${ID}`,
    headline: "제목",
    description: "요약 문장이다.",
    image: `${ORIGIN}/ko${ogImagePath(`/news/${ID}`)}`,
    datePublished: "2026-11-01T02:00:00Z",
    brand: "AI NEWS",
    section: "AI 비즈니스",
    source: { url: "https://www.huxiu.com/article/1.html", outlet: "虎嗅" },
    ...over,
  });
}

test("NewsArticle: Rich Results 필수 속성(headline·image·datePublished·author·publisher.logo)", () => {
  const ld = article();
  assert.equal(ld["@context"], "https://schema.org");
  assert.equal(ld["@type"], "NewsArticle");
  assert.equal(ld.headline, "제목");
  assert.deepEqual(ld.image, [`${ORIGIN}/ko/news/${ID}/opengraph-image`]);
  assert.equal(ld.datePublished, "2026-11-01T02:00:00Z");
  assert.equal(ld.dateModified, "2026-11-01T02:00:00Z");
  assert.equal(ld.author.name, "AI NEWS");
  assert.equal(ld.publisher["@type"], "Organization");
  assert.equal(ld.publisher.logo.url, `${ORIGIN}/logo.png`);
  assert.ok(ld.publisher.logo.width >= 112 && ld.publisher.logo.height >= 112);
  assert.equal(ld.url, `${ORIGIN}/ko/news/${ID}`);
  assert.deepEqual(ld.mainEntityOfPage, { "@type": "WebPage", "@id": `${ORIGIN}/ko/news/${ID}` });
  assert.equal(ld.inLanguage, "ko");
  assert.equal(ld.isBasedOn?.url, "https://www.huxiu.com/article/1.html");
  assert.equal(ld.isBasedOn?.publisher?.name, "虎嗅");
  assert.ok(!("articleBody" in ld), "번역 전문은 넣지 않는다");
});

test("NewsArticle: headline 110자 이하, zh 는 zh-CN, 원문 URL 없으면 isBasedOn 없음", () => {
  const ld = article({ headline: "A".repeat(468), locale: "zh", source: { url: null, outlet: "" } });
  assert.ok([...ld.headline].length <= HEADLINE_MAX);
  assert.ok(ld.headline.endsWith("…"));
  assert.equal(ld.inLanguage, "zh-CN");
  assert.equal(ld.url, `${ORIGIN}/zh/news/${ID}`);
  assert.ok(!("isBasedOn" in ld));
  const noDate = article({ datePublished: null });
  assert.ok(!("datePublished" in noDate));
});

test("BreadcrumbList: 1부터 차례로, item 은 절대 URL", () => {
  const ld = breadcrumbLd([
    { name: "홈", url: `${ORIGIN}/ko` },
    { name: "제목", url: `${ORIGIN}/ko/news/${ID}` },
  ]);
  assert.equal(ld["@type"], "BreadcrumbList");
  assert.deepEqual(
    ld.itemListElement.map((i) => [i["@type"], i.position, i.item]),
    [
      ["ListItem", 1, `${ORIGIN}/ko`],
      ["ListItem", 2, `${ORIGIN}/ko/news/${ID}`],
    ]
  );
});

test("레이아웃: Organization + WebSite, WebSite.publisher 는 같은 @id", () => {
  const [org, site] = siteJsonLd("en", { brand: "AI NEWS", description: "desc" });
  assert.equal(org["@type"], "Organization");
  assert.equal(org["@id"], ORGANIZATION_ID);
  assert.equal(org.url, `${ORIGIN}/en`);
  assert.equal(org.logo.url, `${ORIGIN}/logo.png`);
  assert.equal(site["@type"], "WebSite");
  assert.equal(site.url, `${ORIGIN}/en`);
  assert.equal(site.inLanguage, "en");
  assert.deepEqual(site.publisher, { "@id": ORGANIZATION_ID });
});

test("Gate 2: 브리핑 JSON-LD 의 발행자는 organizationLd 와 같고 공유 카드 이미지를 쓴다", () => {
  const b = {
    id: "x",
    edition_date: "2026-10-13",
    locale: "ko",
    version: 1,
    mode: "full",
    published_at: "2026-10-13T01:00:00Z",
    needs_review: false,
    available_locales: ["ko"],
    content: { headline: "헤드라인", lede: "리드", top_stories: [{ rank: 1, title: "t", refs: [] }] },
    articles: {},
  } as unknown as PublicBriefing;
  const [ld] = briefingJsonLd(b, { brand: "AI NEWS", title: "10월 13일 중국 AI 브리핑: 헤드라인" }) as unknown as [Record<string, unknown>];
  assert.deepEqual(ld.publisher, organizationLd("ko", "AI NEWS"));
  assert.deepEqual(ld.author, organizationLd("ko", "AI NEWS"));
  assert.deepEqual(ld.image, [`${ORIGIN}/ko/briefing/2026-10-13/opengraph-image`]);
});

test("safeJsonLd: </script> 와 U+2028/2029 이스케이프, view.ts 다시 내보내기와 같은 함수", () => {
  const out = safeJsonLd({ t: "</script><script>alert(1)</script>  " });
  assert.ok(!out.includes("<"));
  assert.ok(!out.includes(" ") && !out.includes(" "));
  assert.deepEqual(JSON.parse(out), { t: "</script><script>alert(1)</script>  " });
  assert.equal(viewSafeJsonLd, safeJsonLd);
});
