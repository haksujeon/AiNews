/**
 * 정정 기록(corrections.ts) 단위 테스트 — 실행: npm run test:unit
 * cutoff(출시 전 시험 판 제외), 사유 없는 행, 교체판 링크(발행 시각 순서, 지금 발행 중일 때만).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCorrections, parseSince, type CorrectionSourceRow } from "../../src/lib/briefing/corrections";

let n = 0;
const row = (p: Partial<CorrectionSourceRow>): CorrectionSourceRow => ({
  id: `r${++n}`,
  edition_type: "daily",
  edition_date: "2026-11-05",
  iso_week: null,
  locale: "ko",
  version: 1,
  status: "published",
  published_at: "2026-11-05T00:10:00Z",
  changed_at: null,
  public_note: null,
  ...p,
});

const SINCE = "2026-11-04T15:00:00.000Z"; // 2026-11-05 00:00 KST

test("since 가 null 이면 빈 목록 (정식 발행 전)", () => {
  assert.deepEqual(buildCorrections([row({ status: "withdrawn" })], null), []);
});

test("cutoff 이전에 발행된 시험 판은 나오지 않는다", () => {
  const rows = [
    row({ edition_date: "2026-10-13", status: "superseded", version: 5, published_at: "2026-10-13T09:59:59Z" }),
    row({ edition_date: "2026-10-13", status: "withdrawn", version: 8, published_at: "2026-10-13T10:06:39Z", changed_at: "2026-11-06T00:00:00Z" }),
  ];
  assert.deepEqual(buildCorrections(rows, SINCE), []);
});

test("사유 없는 철회 행은 reason = null, 공백만 있어도 null", () => {
  const out = buildCorrections(
    [row({ status: "withdrawn", public_note: null }), row({ edition_date: "2026-11-06", status: "withdrawn", public_note: "   " })],
    SINCE
  );
  assert.equal(out.length, 2);
  assert.ok(out.every((c) => c.reason === null && c.kind === "withdrawn" && c.replacement === null));
});

test("사유는 공백을 접어 그대로 싣는다", () => {
  const [c] = buildCorrections([row({ status: "withdrawn", public_note: "  수치  오류\n수정 " })], SINCE);
  assert.equal(c.reason, "수치 오류 수정");
});

test("교체판: 버전 번호가 아니라 발행 시각 순서의 다음 판에 링크 (v5 → v8)", () => {
  const out = buildCorrections(
    [
      row({ version: 8, status: "published", published_at: "2026-11-05T02:00:00Z" }),
      row({ version: 5, status: "superseded", published_at: "2026-11-05T00:10:00Z", changed_at: "2026-11-05T02:00:00Z" }),
    ],
    SINCE
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, "superseded");
  assert.deepEqual(out[0].replacement, { path: "/briefing/2026-11-05", version: 8 });
  assert.equal(out[0].changed_at, "2026-11-05T02:00:00.000Z");
});

test("교체판이 나중에 철회됐으면 링크하지 않는다 (두 건 모두 정정 기록)", () => {
  const out = buildCorrections(
    [
      row({ version: 5, status: "superseded", published_at: "2026-11-05T00:10:00Z", changed_at: "2026-11-05T02:00:00Z" }),
      row({ version: 8, status: "withdrawn", published_at: "2026-11-05T02:00:00Z", changed_at: "2026-11-05T05:00:00Z", public_note: "출처 오류" }),
    ],
    SINCE
  );
  assert.equal(out.length, 2);
  assert.ok(out.every((c) => c.replacement === null));
  assert.equal(out[0].version, 8, "최근 변경이 먼저");
  assert.equal(out[0].reason, "출처 오류");
});

test("철회 뒤 다시 발행된 판이 있으면 그 판에 링크", () => {
  const out = buildCorrections(
    [
      row({ version: 2, status: "withdrawn", published_at: "2026-11-05T00:10:00Z", public_note: "오역" }),
      row({ version: 3, status: "published", published_at: "2026-11-05T03:00:00Z" }),
    ],
    SINCE
  );
  assert.deepEqual(out[0].replacement, { path: "/briefing/2026-11-05", version: 3 });
});

test("주간 판은 ISO 주로 표시·링크, 언어별로 따로 묶는다", () => {
  const out = buildCorrections(
    [
      row({ edition_type: "weekly", iso_week: "2026-W45", version: 1, status: "superseded" }),
      row({ edition_type: "weekly", iso_week: "2026-W45", version: 2, status: "published", published_at: "2026-11-05T04:00:00Z" }),
      row({ locale: "en", version: 1, status: "superseded" }), // en 계열: 대체판 없음
    ],
    SINCE
  );
  const weekly = out.find((c) => c.edition_type === "weekly")!;
  assert.equal(weekly.edition_label, "2026-W45");
  assert.deepEqual(weekly.replacement, { path: "/briefing/weekly/2026-W45", version: 2 });
  assert.equal(out.find((c) => c.edition_type === "daily")!.replacement, null);
});

test("parseSince: 날짜는 KST 자정, 잘못된 값은 null", () => {
  assert.equal(parseSince("2026-11-05"), "2026-11-04T15:00:00.000Z");
  assert.equal(parseSince("2026-11-05T09:00:00+09:00"), "2026-11-05T00:00:00.000Z");
  assert.equal(parseSince("nope"), null);
  assert.equal(parseSince(""), null);
  assert.equal(parseSince(undefined), null);
});
