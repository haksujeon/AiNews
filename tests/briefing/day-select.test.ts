/**
 * 홈 날짜 묶음 ↔ 데일리 판 고르기(day-select.ts)와 "발행 예정" 판정(sla.ts isEditionPending) — 실행: npm run test:unit
 * 2026-10-31 은 토요일, 2026-11-01 은 일요일, 2026-11-02 는 월요일.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { coversDay, pickLinkEdition, pickRankEdition, toDayBriefingRef, type DayEditionRow } from "../../src/lib/briefing/day-select";
import { editionForNewsDay, isEditionPending } from "../../src/lib/briefing/sla";
import { citedRanksFromTopStories, splitDay, type RankableArticle } from "../../src/lib/news-rank";

const row = (edition_date: string, locale: string, p: Partial<DayEditionRow> = {}): DayEditionRow => ({
  edition_date,
  period_start: edition_date,
  period_end: edition_date,
  locale,
  status: "published",
  headline: `${edition_date}-${locale}`,
  top_stories: [],
  ...p,
});
const weekend = (locale: string, p: Partial<DayEditionRow> = {}) => row("2026-10-31", locale, { period_end: "2026-11-01", ...p });
const kst = (s: string) => new Date(`${s}+09:00`);

test("coversDay: 기간 양 끝 포함", () => {
  const w = weekend("ko");
  assert.equal(coversDay(w, "2026-10-31"), true);
  assert.equal(coversDay(w, "2026-11-01"), true);
  assert.equal(coversDay(w, "2026-10-30"), false);
  assert.equal(coversDay(w, "2026-11-02"), false);
});

test("토요일 합본이 토·일 두 묶음을 모두 덮고 같은 판으로 연결된다", () => {
  const rows = [weekend("ko")];
  const sat = pickLinkEdition(rows, "2026-10-31", "ko");
  const sun = pickLinkEdition(rows, "2026-11-01", "ko");
  assert.equal(sat?.edition_date, "2026-10-31");
  assert.equal(sun?.edition_date, "2026-10-31");
  assert.deepEqual(toDayBriefingRef(sun!), { editionDate: "2026-10-31", weekend: true, headline: "2026-10-31-ko" });
  assert.equal(toDayBriefingRef(row("2026-10-30", "ko")).weekend, false);
});

test("같은 날짜 판 우선: 일요일 단독판이 있으면 일요일 묶음은 그 판, 토요일 묶음은 합본", () => {
  const rows = [weekend("ko"), row("2026-11-01", "ko")];
  assert.equal(pickLinkEdition(rows, "2026-11-01", "ko")?.edition_date, "2026-11-01");
  assert.equal(pickLinkEdition(rows, "2026-10-31", "ko")?.edition_date, "2026-10-31");
  assert.equal(pickRankEdition(rows, "2026-11-01", "ko")?.edition_date, "2026-11-01");
});

test("링크는 보는 언어판만 — 다른 언어판만 있으면 링크 없음 (결정 1)", () => {
  const rows = [row("2026-10-29", "en")];
  assert.equal(pickLinkEdition(rows, "2026-10-29", "ko"), null);
  assert.equal(pickLinkEdition(rows, "2026-10-29", "en")?.locale, "en");
});

test("링크: ko 단독 일요일판이 en 토요일 합본을 가리지 않는다", () => {
  const rows = [weekend("en"), row("2026-11-01", "ko")];
  assert.equal(pickLinkEdition(rows, "2026-11-01", "en")?.edition_date, "2026-10-31");
  assert.equal(pickLinkEdition(rows, "2026-11-01", "ko")?.edition_date, "2026-11-01");
});

test("순위용 언어 우선순위: 보는 언어 → ko → 그 밖(이름순)", () => {
  const rows = [row("2026-10-30", "zh"), row("2026-10-30", "ko"), row("2026-10-30", "en")];
  assert.equal(pickRankEdition(rows, "2026-10-30", "en")?.locale, "en");
  assert.equal(pickRankEdition(rows, "2026-10-30", "zh")?.locale, "zh");
  assert.equal(pickRankEdition(rows.filter((r) => r.locale !== "ko"), "2026-10-30", "ko")?.locale, "en");
  assert.equal(pickRankEdition([row("2026-10-30", "zh"), row("2026-10-30", "ko")], "2026-10-30", "en")?.locale, "ko");
});

test("발행본이 아닌 판(초안·철회·교체·실패)은 링크·순위 모두 제외", () => {
  for (const status of ["draft", "withdrawn", "superseded", "failed", "generating", "skipped"]) {
    const rows = [row("2026-10-30", "ko", { status })];
    assert.equal(pickLinkEdition(rows, "2026-10-30", "ko"), null, status);
    assert.equal(pickRankEdition(rows, "2026-10-30", "ko"), null, status);
  }
});

test("일요일 순위: 토요일 합본의 주요 기사가 일요일 묶음에서도 맨 앞 (예전 버그: 합본을 못 찾아 인용 우선이 빠짐)", () => {
  const art = (id: string, source: string): RankableArticle => ({
    id,
    source_name: source,
    category: "ai-tech",
    title_cn: `标题${id}${id}${id}`,
    title_kr: `제목 ${id}`,
    summary_kr: "",
  });
  // 점수만으로는 s1(권위 높은 매체)이 앞선다
  const sunday = [art("s1", "Qbitai"), art("s2", "Huxiu")];
  assert.equal(splitDay(sunday).top[0].item.id, "s1");
  const rows = [weekend("ko", { top_stories: [{ rank: 1, primary_ref: "s2", refs: ["s2"] }] })];
  const picked = pickRankEdition(rows, "2026-11-01", "ko");
  assert.equal(picked?.edition_date, "2026-10-31");
  const { top } = splitDay(sunday, { cited: citedRanksFromTopStories(picked!.top_stories) });
  assert.equal(top[0].item.id, "s2");
});

test("editionForNewsDay: 일요일 → 토요일 합본, 그 밖은 그날", () => {
  assert.equal(editionForNewsDay("2026-11-01"), "2026-10-31");
  assert.equal(editionForNewsDay("2026-10-31"), "2026-10-31");
  assert.equal(editionForNewsDay("2026-10-30"), "2026-10-30");
});

test("isEditionPending: 평일판 D 는 D+1 09:00 KST 직전까지 예정", () => {
  assert.equal(isEditionPending("2026-10-30", kst("2026-10-30T15:00:00")), true);
  assert.equal(isEditionPending("2026-10-30", kst("2026-10-31T08:59:59")), true);
  assert.equal(isEditionPending("2026-10-30", kst("2026-10-31T09:00:00")), false);
});

test("isEditionPending: 토·일 묶음은 월요일 09:00 KST 까지 예정 (금요일판은 토요일 09:00)", () => {
  for (const d of ["2026-10-31", "2026-11-01"]) {
    assert.equal(isEditionPending(d, kst("2026-11-02T08:59:00")), true, d);
    assert.equal(isEditionPending(d, kst("2026-11-02T09:00:00")), false, d);
  }
  assert.equal(isEditionPending("2026-10-30", kst("2026-11-01T12:00:00")), false);
});

test("isEditionPending: 오늘 묶음은 언제나 예정 (01:00 KST 이후 베이징 날짜가 넘어가도)", () => {
  // 11-02 01:30 KST = 베이징 11-02 00:30 → 오늘 묶음 11-02, 어제 묶음 11-01(토요일 합본, 오늘 09:00 마감)
  const now = kst("2026-11-02T01:30:00");
  assert.equal(isEditionPending("2026-11-02", now), true);
  assert.equal(isEditionPending("2026-11-01", now), true);
  assert.equal(isEditionPending("2026-11-02", kst("2026-11-02T23:59:00")), true);
});
