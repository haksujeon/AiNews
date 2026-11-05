/** 구독 신청 — 입력 검사·봇 거르기·접속 제한·확인 토큰 (signup.ts) */
import { test } from "node:test";
import assert from "node:assert/strict";

import * as s from "../../src/lib/newsletter/signup";

// 토큰 키는 부를 때 읽는다 (가져오기보다 늦어도 됨)
process.env.ADMIN_SECRET ??= "x".repeat(40);

const ok = { organization: " 회사 ", name: "홍길동", jobTitle: "", email: "Name@Example.COM ", language: "ko", consent: true, age14: true };

test("회사·이름·이메일·언어 필수, 직책 선택, 동의·14세 필수", () => {
  const r = s.parseSignup(ok);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.input.organization, "회사");
    assert.equal(r.input.email, "name@example.com");
    assert.equal(r.input.jobTitle, null);
  }
  const bad = s.parseSignup({ ...ok, organization: "", name: " ", email: "x@", language: "jp", consent: false, age14: false });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.deepEqual(bad.fields.sort(), ["age", "consent", "email", "language", "name", "organization"]);
});

test("출처(src)는 영문·숫자·-_ 만", () => {
  const r = s.parseSignup({ ...ok, source: "seminar-2611<script>" });
  assert.ok(r.ok && r.input.source === "seminar-2611script");
});

test("봇: 숨은 칸이 채워졌거나 3초 안에 제출", () => {
  const now = 1_000_000_000;
  assert.equal(s.looksLikeBot({ website: "spam", t0: now - 10_000 }, now), true);
  assert.equal(s.looksLikeBot({ t0: now - 1_000 }, now), true);
  assert.equal(s.looksLikeBot({ t0: now - 10_000 }, now), false);
  assert.equal(s.looksLikeBot({}, now), true);
});

test("같은 접속 주소 1시간 5건까지", () => {
  const now = 2_000_000_000;
  for (let i = 0; i < 5; i++) assert.equal(s.rateLimited("1.2.3.4", now + i), false);
  assert.equal(s.rateLimited("1.2.3.4", now + 10), true);
  assert.equal(s.rateLimited("1.2.3.4", now + s.RATE_LIMIT.windowMs + 100), false);
});

test("확인 토큰: 맞으면 id, 위조·만료면 null", () => {
  const id = "123e4567-e89b-42d3-a456-426614174000";
  const now = Date.now();
  const tok = s.confirmToken(id, now);
  assert.equal(s.verifyConfirmToken(tok, now), id);
  assert.equal(s.verifyConfirmToken(tok, now + (s.CONFIRM_TTL_HOURS + 1) * 3600 * 1000), null);
  assert.equal(s.verifyConfirmToken(tok.slice(0, -2) + "xx", now), null);
  assert.equal(s.verifyConfirmToken("garbage", now), null);
});
