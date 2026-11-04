/** 구독자 메일 — 수신 거부 토큰·판 날짜 표기 (token.ts, daily-email.ts) */
import { test } from "node:test";
import assert from "node:assert/strict";

import { unsubscribeToken, verifyUnsubscribeToken, unsubscribePageUrl } from "../../src/lib/newsletter/token";
import { editionDateLabel } from "../../src/lib/newsletter/daily-email";
import { currentEdition } from "../../src/lib/briefing/sla";

process.env.NEWSLETTER_SECRET = "x".repeat(40); // 키는 부를 때 읽는다

const ID = "3f2b8c1e-1d2a-4b5c-9d8e-7f6a5b4c3d2e";

test("토큰: 되돌리면 같은 id, 고치면 거부", () => {
  const t = unsubscribeToken(ID);
  assert.equal(verifyUnsubscribeToken(t), ID);
  assert.equal(verifyUnsubscribeToken(t.slice(0, -1) + (t.endsWith("A") ? "B" : "A")), null);
  assert.equal(verifyUnsubscribeToken(unsubscribeToken("3f2b8c1e-1d2a-4b5c-9d8e-7f6a5b4c3d2f").split(".")[0] + "." + t.split(".")[1]), null);
  assert.equal(verifyUnsubscribeToken(""), null);
  assert.equal(verifyUnsubscribeToken("abc"), null);
  assert.equal(verifyUnsubscribeToken(null), null);
});

test("수신 거부 화면 주소에 basePath·언어가 들어간다", () => {
  assert.match(unsubscribePageUrl("zh", ID), /\/ainews\/zh\/unsubscribe\?t=|\/zh\/unsubscribe\?t=/);
});

test("판 날짜 표기: 하루·주말 합본", () => {
  assert.equal(editionDateLabel("ko", "2026-11-03"), "11월 3일(화)");
  assert.equal(editionDateLabel("ko", "2026-10-31", "2026-11-01"), "10월 31일(토) ~ 11월 1일(일)");
  assert.equal(editionDateLabel("zh", "2026-11-07", "2026-11-08"), "11月7日（周六）至8日（周日）");
});

test("아침 7시에 보낼 판 = currentEdition (화 → 월판, 일 → 금판, 월 → 토 합본)", () => {
  const at7 = (d: string) => new Date(`${d}T07:00:00+09:00`);
  assert.equal(currentEdition(at7("2026-11-04")), "2026-11-03");
  assert.equal(currentEdition(at7("2026-11-08")), "2026-11-06");
  assert.equal(currentEdition(at7("2026-11-09")), "2026-11-07");
  assert.equal(currentEdition(at7("2026-11-07")), "2026-11-06");
});

test("주말 판 고르기: 토·일 07:00/10:00 = 금요일 판(일요일은 이미 보냄), 월 07:00/10:00 = 토·일 합본", async () => {
  const kst = (s: string) => new Date(new Date(s + ":00Z").getTime() - 9 * 3600e3);
  for (const t of ["2026-11-07T07:00", "2026-11-07T10:00", "2026-11-08T07:00", "2026-11-08T10:00"]) assert.equal(currentEdition(kst(t)), "2026-11-06", t);
  for (const t of ["2026-11-09T07:00", "2026-11-09T10:00"]) assert.equal(currentEdition(kst(t)), "2026-11-07", t);
});
