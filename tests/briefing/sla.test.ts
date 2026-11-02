/**
 * 발행 일정·SLA(sla.ts) 단위 테스트 — 실행: npm run test:unit
 * 베이징·KST 날짜 경계, 09:00 마감 직전·직후, 주말 합본 규칙, 14일 발행률, 홈 배너 날짜 칩.
 * 2026-11-02 은 월요일, 2026-10-31 은 토요일.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bannerState,
  beijingDate,
  currentEdition,
  dueAtOf,
  dueEditionsInWindow,
  editionPeriod,
  evaluateSla,
  kstClock,
  lastDueEdition,
  previousEdition,
  scheduledEditionFor,
  scheduledRunEdition,
  type EditionFacts,
} from "../../src/lib/briefing/sla";
import { beijingToday } from "../../src/lib/briefing/generate";

/** KST 벽시계 → Date */
const kst = (s: string) => new Date(`${s}+09:00`);

const fact = (d: string, p: Partial<EditionFacts> = {}): EditionFacts => ({
  edition_date: d,
  latest_status: "draft",
  published_now: false,
  first_published_at: null,
  has_content: true,
  ...p,
});

test("KST 23:59 는 베이징 22:59 — 같은 날짜, generate 의 beijingToday 와 일치", () => {
  const now = kst("2026-11-03T23:59:00");
  assert.equal(kstClock(now).date, "2026-11-03");
  assert.equal(beijingDate(now), "2026-11-03");
  assert.equal(beijingToday(now), "2026-11-03");
  // KST 00:30 (재시도) = 베이징 전날 23:30 → 같은 판
  const retry = kst("2026-11-04T00:30:00");
  assert.equal(beijingDate(retry), "2026-11-03");
  assert.equal(beijingToday(retry), "2026-11-03");
  assert.equal(scheduledRunEdition(retry), "2026-11-03");
});

test("현재 판: 23:40 KST 에 넘어간다", () => {
  assert.equal(currentEdition(kst("2026-11-03T23:39:00")), "2026-11-02");
  assert.equal(currentEdition(kst("2026-11-03T23:40:00")), "2026-11-03");
  assert.equal(currentEdition(kst("2026-11-04T08:59:00")), "2026-11-03");
});

test("마감: 평일판은 다음 날 09:00 KST, 직전·직후", () => {
  assert.equal(dueAtOf("2026-11-03").toISOString(), kst("2026-11-04T09:00:00").toISOString());
  const facts = [fact("2026-11-03")];
  const before = evaluateSla(kst("2026-11-04T08:59:59"), facts, null);
  assert.equal(before.editionDate, "2026-11-03");
  assert.equal(before.overdue, false);
  assert.equal(before.generated, true);
  const after = evaluateSla(kst("2026-11-04T09:00:00"), facts, null);
  assert.equal(after.overdue, true);
  assert.equal(after.notify, true);
  // 09:30 점검
  assert.equal(evaluateSla(kst("2026-11-04T09:30:00"), facts, null).notify, true);
  // 발행하면 overdue 아님
  const pub = evaluateSla(kst("2026-11-04T09:30:00"), [fact("2026-11-03", { latest_status: "published", published_now: true })], null);
  assert.equal(pub.published, true);
  assert.equal(pub.overdue, false);
});

test("주말 규칙: 토요일 판 = 토·일 합본, 일요일 23:40 생성, 월요일 09:00 마감", () => {
  assert.deepEqual(editionPeriod("2026-10-31"), { editionDate: "2026-10-31", periodStart: "2026-10-31", periodEnd: "2026-11-01", weekend: true });
  assert.deepEqual(editionPeriod("2026-11-02"), { editionDate: "2026-11-02", periodStart: "2026-11-02", periodEnd: "2026-11-02", weekend: false });
  assert.equal(scheduledEditionFor("2026-10-31"), null); // 토요일 밤: 생성 안 함
  assert.equal(scheduledEditionFor("2026-11-01"), "2026-10-31"); // 일요일 밤: 토요일 합본
  assert.equal(scheduledEditionFor("2026-10-30"), "2026-10-30"); // 금요일
  assert.equal(scheduledRunEdition(kst("2026-10-31T23:40:00")), null);
  assert.equal(scheduledRunEdition(kst("2026-11-01T23:40:00")), "2026-10-31");
  assert.equal(dueAtOf("2026-10-31").toISOString(), kst("2026-11-02T09:00:00").toISOString());
  // 금요일판 마감은 토요일 09:00
  assert.equal(dueAtOf("2026-10-30").toISOString(), kst("2026-10-31T09:00:00").toISOString());
  // 토·일 낮에는 금요일판이 현재 판, 일요일 23:40 부터 토요일 합본
  assert.equal(currentEdition(kst("2026-10-31T23:50:00")), "2026-10-30");
  assert.equal(currentEdition(kst("2026-11-01T12:00:00")), "2026-10-30");
  assert.equal(currentEdition(kst("2026-11-01T23:40:00")), "2026-10-31");
  assert.equal(currentEdition(kst("2026-11-02T09:30:00")), "2026-10-31");
  assert.equal(previousEdition("2026-11-02"), "2026-10-31");
  assert.equal(previousEdition("2026-10-31"), "2026-10-30");
  assert.equal(previousEdition("2026-11-03"), "2026-11-02");
});

test("알림은 판마다 1회: 금요일판 미발행이면 토 09:30 알림, 일 09:30 은 알리지 않음", () => {
  const facts = [fact("2026-10-30")];
  const sat = evaluateSla(kst("2026-10-31T09:30:00"), facts, null);
  assert.equal(sat.editionDate, "2026-10-30");
  assert.equal(sat.overdue && sat.notify, true);
  const sun = evaluateSla(kst("2026-11-01T09:30:00"), facts, null);
  assert.equal(sun.editionDate, "2026-10-30");
  assert.equal(sun.overdue, true);
  assert.equal(sun.notify, false);
  // 월 09:30: 토요일 합본 미생성 → 알림
  const mon = evaluateSla(kst("2026-11-02T09:30:00"), facts, null);
  assert.equal(mon.editionDate, "2026-10-31");
  assert.equal(mon.weekend, true);
  assert.equal(mon.generated, false);
  assert.equal(mon.notify, true);
});

test("물량 부족으로 생략한 판은 overdue 가 아니고 발행률 분모에서 빠진다", () => {
  const s = evaluateSla(kst("2026-11-04T09:30:00"), [fact("2026-11-03", { latest_status: "skipped", has_content: false })], null);
  assert.equal(s.overdue, false);
  assert.equal(s.notify, false);
});

test("14일 발행률: 마감 지난 정기 판만 (일요일 날짜 없음), 철회·교체도 발행으로, 마감 안 발행 수", () => {
  const now = kst("2026-11-04T09:30:00");
  const due = dueEditionsInWindow(now);
  assert.equal(due[0], "2026-11-03");
  assert.ok(due.every((d) => new Date(`${d}T00:00:00Z`).getUTCDay() !== 0), "일요일 날짜는 판이 아니다");
  assert.ok(due.includes("2026-10-31") && due.includes("2026-10-24"));
  assert.equal(due.length, 11); // 10-22 ~ 11-03: 평일 9 + 주말 합본 2 (11-04 판은 아직 마감 전)
  const facts = [
    fact("2026-11-03", { latest_status: "published", published_now: true, first_published_at: kst("2026-11-04T08:00:00").toISOString() }),
    fact("2026-11-02", { latest_status: "withdrawn", first_published_at: kst("2026-11-03T10:00:00").toISOString() }), // 늦게 발행 후 철회
    fact("2026-10-29", { latest_status: "skipped", has_content: false }),
  ];
  const s = evaluateSla(now, facts, { editionDate: "2026-11-03", publishedAt: null });
  assert.equal(s.rate14d.eligible, 10);
  assert.equal(s.rate14d.published, 2);
  assert.equal(s.rate14d.onTime, 1);
  assert.equal(s.rate14d.rate, 2 / 10);
});

test("배너: 발행본이 없으면 숨김, 최근 판이면 칩 없음, 오래된 판이면 날짜 칩", () => {
  const now = kst("2026-11-04T10:00:00"); // 마감 지난 최근 판 = 11-03
  assert.equal(lastDueEdition(now), "2026-11-03");
  assert.deepEqual(bannerState(null, now), { show: false });
  assert.deepEqual(bannerState("2026-11-03", now), { show: true, dated: false });
  assert.deepEqual(bannerState("2026-11-02", now), { show: true, dated: true });
  // 마감 전(08:00)에는 11-02 판이 최신 기대 판 → 칩 없음, 그 전 판이면 칩
  const early = kst("2026-11-04T08:00:00");
  assert.equal(lastDueEdition(early), "2026-11-02");
  assert.deepEqual(bannerState("2026-11-02", early), { show: true, dated: false });
  assert.deepEqual(bannerState("2026-10-31", early), { show: true, dated: true });
  // 월요일 오전: 금요일판만 있으면(토 합본 마감 전) 칩 없음
  assert.deepEqual(bannerState("2026-10-30", kst("2026-11-02T08:00:00")), { show: true, dated: false });
});
