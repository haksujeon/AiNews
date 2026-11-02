/** RSS(src/lib/feed.ts) 단위 테스트 — 실행: npm run test:unit */
import "./env";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildRss,
  escapeXml,
  FEED_DESCRIPTION_MAX,
  FEED_MAX_ITEMS,
  feedPath,
  feedUrl,
  parseFeedSlug,
  rfc822,
  type FeedItem,
} from "../../src/lib/feed";
import { clipText } from "../../src/lib/seo/text";

const channel = {
  title: "AI NEWS — 최신 기사",
  link: "https://news.aibaseclub.com/ainews/ko",
  description: "제목과 요약",
  language: "ko",
  selfUrl: "https://news.aibaseclub.com/ainews/feed/ko/all.xml",
};

/** 텍스트 노드를 되돌린다(테스트용 최소 디코더) */
function unescape(s: string): string {
  return s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

test("escapeXml: & < > 따옴표와 ']]>' 를 엔티티로", () => {
  assert.equal(escapeXml(`a & b <i>"x" 'y'</i>`), "a &amp; b &lt;i&gt;&quot;x&quot; &apos;y&apos;&lt;/i&gt;");
  assert.equal(escapeXml("끝]]>뒤"), "끝]]&gt;뒤");
  assert.equal(escapeXml("&amp;"), "&amp;amp;", "이미 이스케이프된 값도 한 번 더 (원문 그대로 보이게)");
  assert.equal(escapeXml(null), "");
});

test("escapeXml: XML 1.0 에서 못 쓰는 제어 문자는 지우고 탭·줄바꿈은 남긴다", () => {
  assert.equal(escapeXml("a\u0000b\u0008c\u000Bd\u001Fe￾f"), "abcdef");
  assert.equal(escapeXml("a\tb\nc\rd"), "a\tb\nc\rd");
  assert.equal(escapeXml("짝없는\uD800서로게이트"), "짝없는서로게이트");
  assert.equal(escapeXml("이모지😀"), "이모지😀");
});

test("rfc822: GMT RFC 822(1123) 형식, 잘못된 값은 null", () => {
  assert.equal(rfc822("2026-11-02T03:04:05Z"), "Mon, 02 Nov 2026 03:04:05 GMT");
  assert.equal(rfc822("2026-10-13T00:00:00+08:00"), "Mon, 12 Oct 2026 16:00:00 GMT");
  assert.match(rfc822(new Date())!, /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/);
  assert.equal(rfc822("not a date"), null);
  assert.equal(rfc822(null), null);
});

test("buildRss: 항목 50개 상한, 설명 300자 상한, content:encoded 없음, atom self", () => {
  const items: FeedItem[] = Array.from({ length: 60 }, (_, i) => ({
    title: `제목 ${i} & <b>`,
    link: `https://news.aibaseclub.com/ainews/ko/news/${i}`,
    description: "가".repeat(500) + "]]>",
    pubDate: `2026-11-0${(i % 9) + 1}T00:00:00Z`,
    category: "AI 비즈니스",
  }));
  const xml = buildRss(channel, items);
  assert.ok(xml.startsWith(`<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">`));
  assert.equal((xml.match(/<item>/g) ?? []).length, FEED_MAX_ITEMS);
  assert.ok(!xml.includes("content:encoded"));
  assert.ok(!xml.includes("<![CDATA["));
  assert.ok(xml.includes(`<atom:link href="${channel.selfUrl}" rel="self" type="application/rss+xml"/>`));
  for (const m of xml.matchAll(/<description>([^<]*)<\/description>/g)) {
    // XML 을 한 번 풀면 HTML, HTML 을 한 번 더 풀면 원래 글
    assert.ok([...unescape(unescape(m[1]))].length <= FEED_DESCRIPTION_MAX, "설명 300자 이하");
  }
  const one = buildRss(channel, [{ title: "t", link: "https://x/1", description: "R&D 투자 ]]> <b>굵게</b>" }]);
  assert.ok(
    one.includes("<description>R&amp;amp;D 투자 ]]&amp;gt; &amp;lt;b&amp;gt;굵게&amp;lt;/b&amp;gt;</description>"),
    "설명은 HTML 로 한 번, XML 로 한 번 이스케이프 (W3C NotHtml 경고 방지)"
  );
  assert.ok(xml.includes("<title>제목 0 &amp; &lt;b&gt;</title>"));
  assert.ok(!/<b>/.test(xml), "본문 태그가 그대로 들어가지 않는다");
  assert.ok(xml.includes(`<guid isPermaLink="true">https://news.aibaseclub.com/ainews/ko/news/0</guid>`));
  assert.ok(xml.includes("<pubDate>Sun, 01 Nov 2026 00:00:00 GMT</pubDate>"));
  // 태그 짝이 맞는다(간이 검사): 여는 item 과 닫는 item 수가 같고 문서가 </rss> 로 끝난다
  assert.equal((xml.match(/<\/item>/g) ?? []).length, FEED_MAX_ITEMS);
  assert.ok(xml.trimEnd().endsWith("</channel>\n</rss>"));
});

test("buildRss: 항목이 없어도 유효한 채널(브리핑 발행 전)", () => {
  const xml = buildRss(channel, []);
  assert.ok(xml.includes("<channel>") && xml.includes("<lastBuildDate>"));
  assert.equal((xml.match(/<item>/g) ?? []).length, 0);
});

test("피드 경로·slug: 언어 3개 × all/briefing/category, 모르는 값은 null", () => {
  assert.equal(feedPath("ko", { kind: "all" }), "/feed/ko/all.xml");
  assert.equal(feedPath("zh", { kind: "category", category: "ai-biz" }), "/feed/zh/category/ai-biz.xml");
  assert.equal(feedUrl("en", { kind: "briefing" }), "https://news.aibaseclub.com/ainews/feed/en/briefing.xml");
  assert.deepEqual(parseFeedSlug("ko", ["all.xml"]), { kind: "all" });
  assert.deepEqual(parseFeedSlug("en", ["briefing.xml"]), { kind: "briefing" });
  assert.deepEqual(parseFeedSlug("zh", ["category", "ai-tech.xml"]), { kind: "category", category: "ai-tech" });
  assert.equal(parseFeedSlug("ko", ["category", "politics.xml"]), null);
  assert.equal(parseFeedSlug("ko", ["all"]), null);
  assert.equal(parseFeedSlug("ja", ["all.xml"]), null);
  assert.equal(parseFeedSlug("ko", ["category", "ai-biz.xml", "x"]), null);
});

test("clipText: 코드 포인트 단위로 자르고 … 로 끝낸다", () => {
  assert.equal(clipText("짧다", 10), "짧다");
  assert.equal(clipText("  여러   칸\n공백 ", 20), "여러 칸 공백");
  const s = clipText("😀".repeat(10), 5);
  assert.equal([...s].length, 5);
  assert.ok(s.endsWith("…"));
  assert.equal(clipText(null, 5), "");
});
