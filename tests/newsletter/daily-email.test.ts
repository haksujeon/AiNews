/** 구독자 메일 화면 (daily-email.ts) — 히스토리 요약형·관점 1개·없음, 102KB 잘림 방지 */
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.NEXT_PUBLIC_BASE_PATH ??= "/ainews";
import { renderDailyEmail, MAIL_SIZE_LIMIT } from "../../src/lib/newsletter/daily-email";
import type { PublicBriefing } from "../../src/lib/briefing/public";
import type { StoryContext } from "../../src/lib/briefing/types";

const ctx = (lens: "company" | "topic", n: number, pad = 0): StoryContext => ({
  lens,
  title: `${lens} 흐름`,
  background: "배경 문장입니다." + "가".repeat(pad),
  timeline: Array.from({ length: n }, (_, i) => ({ date: `2026-10-${String(i + 10)}`, text: `항목 ${i}` + "나".repeat(pad), refs: [{ id: `r${i}`, source: "36Kr", title: "t" }] })),
  now: "이번 기사 문장",
  caution: null,
});

function briefing(contexts: (StoryContext[] | undefined)[]): PublicBriefing {
  return {
    id: "b1", locale: "ko", edition_date: "2026-11-03", period_end: "2026-11-03", articles: {},
    content: {
      headline: "헤드라인", lede: "리드", lede_refs: [],
      top_stories: contexts.map((sc, i) => ({ rank: i + 1, title: `제목 ${i + 1}`, subject: "딥시크", section: "products", what: "무엇", why: "왜", refs: [`a${i}`], primary_ref: `a${i}`, story_context: sc })),
      key_numbers: [], sections: [], companies_to_watch: [], term_of_the_day: null,
      meta: { candidate_count: 10, cited_count: 5 },
    },
  } as unknown as PublicBriefing;
}
const opts = { name: "홍길동", email: "a@example.com", unsubscribeUrl: "https://x/u?t=1" };

test("두 관점은 나란히, 연대기는 최근 3건 + 'N건 더', 사이트 링크", () => {
  const m = renderDailyEmail(briefing([[ctx("company", 6), ctx("topic", 4)]]), opts);
  assert.match(m.html, /회사 흐름/);
  assert.match(m.html, /관련 주제 흐름/);
  assert.match(m.html, /10\.10부터 3건 더/);
  assert.match(m.html, /10\.10부터 1건 더/);
  assert.doesNotMatch(m.html, />항목 0</);
  assert.match(m.html, />항목 5</);
  assert.match(m.html, /지난 흐름 10건 전체와 근거 기사 보기/);
  assert.match(m.html, /#story-1/);
  assert.match(m.html, /max-width:880px/);
  assert.match(m.html, /히스토리 분석은 지난 보도를/);
});

test("관점 하나면 한 칸, 히스토리 없는 판은 상자·안내 줄 없음", () => {
  const one = renderDailyEmail(briefing([[ctx("topic", 3)]]), opts);
  assert.doesNotMatch(one.html, /회사 흐름/);
  assert.doesNotMatch(one.html, /건 더/);
  const none = renderDailyEmail(briefing([undefined, undefined]), opts);
  assert.doesNotMatch(none.html, /🕘/);
  assert.doesNotMatch(none.html, /히스토리 분석은 지난 보도를/);
});

test(`HTML 이 ${MAIL_SIZE_LIMIT} 바이트를 넘으면 뒤 기사부터 히스토리를 한 줄로 줄인다`, () => {
  const big = Array.from({ length: 5 }, () => [ctx("company", 6, 800), ctx("topic", 6, 800)]);
  const m = renderDailyEmail(briefing(big), opts);
  assert.ok(Buffer.byteLength(m.html) <= MAIL_SIZE_LIMIT, `크기 ${Buffer.byteLength(m.html)}`);
  // 1번 기사는 요약형, 마지막 기사는 한 줄
  const parts = m.html.split("#story-");
  assert.match(m.html, /지난 흐름 12건 전체와 근거 기사 보기/);
  assert.match(m.html, /사이트에서 지난 흐름 보기/);
  assert.ok(parts.length >= 6);
});

test("토·일 합본(월요일 메일)은 '어제' 대신 주말 문구, 날짜는 범위", () => {
  const b = briefing([undefined]);
  (b as { edition_date: string; period_end: string }).edition_date = "2026-11-07";
  (b as { period_end: string }).period_end = "2026-11-08";
  const m = renderDailyEmail(b, opts);
  assert.match(m.subject, /11월 7일\(토\)~8일\(일\)/);
  assert.match(m.html, /지난 주말\(토·일\)/);
  assert.match(m.html, /주말\(토·일\) 공개 기사 10건 중 5건/);
  assert.doesNotMatch(m.html, /어제 중국 AI/);
  const day = renderDailyEmail(briefing([undefined]), opts);
  assert.match(day.html, /어제 중국 AI 업계/);
});

test("한눈에 보기: 카드 명세의 큰 숫자·증감·그림, 명세 없으면 숫자로 보는 하루 값 — 목차·숫자 칸·한 장 요약 그림은 없음", () => {
  const b = briefing([undefined, undefined]);
  b.content.key_numbers = [{ value: "30개", label: "투자자 수", ref: "a1" }] as never;
  const plain = renderDailyEmail(b, opts);
  assert.match(plain.html, /한눈에 보기/);
  assert.match(plain.html, /주요 2건/);
  assert.match(plain.html, />30개</);
  assert.doesNotMatch(plain.html, /숫자로 보는 어제|이번 호 주요 기사|한 장 요약|<img/);
  const spec = {
    stories: [
      { rank: 1, big: { raw: "1055억 위안", label: "2차 라운드", dir: "up" }, figure: { kind: "timeline", items: [{ when: "11월 4일", label: "테스트" }, { when: "12월", label: "배포" }] }, note: "메모" },
      { rank: 2, big: null, figure: { kind: "none" }, note: "" },
    ],
  } as never;
  const withSpec = renderDailyEmail(b, { ...opts, cardSpec: spec });
  assert.match(withSpec.html, /▲<\/span> 1055억 위안/);
  assert.match(withSpec.html, /11월 4일 → 12월|12월/);
  assert.match(withSpec.html, /메모/);
  assert.match(withSpec.html, /class="gcell"/);
});
