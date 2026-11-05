/** 브리핑 음성·카드 — 장(챕터) 찾기·시각·대체 글·행 변환 (media.ts · media-store.ts toMediaSet) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { cardAltText, chapterAt, chapterStart, chaptersFromTranscript, formatClock, parseClock } from "../../src/lib/briefing/media";
import { toMediaSet, type MediaRow } from "../../src/lib/briefing/media-store";

// 11월 4일 판 NotebookLM 1인 요약의 받아쓰기 (발췌, 시각·서수 그대로)
const BRIEF = `A: 0:00 바쁜 직장인 여러분을 위해 핵심만 빠르게 짚어 드리는 브리핑입니다.
A: 0:08 거액의 투자자본 유입부터 공장 로봇 투입까지 보여줍니다.
A: 0:24 자, 첫째. 딥시크의 1055억 위안 규모 두 번째 투자 유치 소식입니다.
A: 0:29 약 30개 투자자가 참여했고요.
A: 0:45 둘째는 애플 중국판 아이폰에 알리바바의 AI가 탑재된다는 건데요.
A: 1:00 셋째. 이 치엔원의 영토 확장이 대중적인 쇼핑 채널로도 이어졌습니다.
A: 1:25 넷째로 넘어가 보죠.
A: 1:46 마지막 다섯째.
A: 1:48 샤오미의 휴머노이드 로봇이 8시간 연속 작업을 해냈습니다.
A: 2:05 요약하자면 AI가 현실을 바꾸고 있습니다.`;

test("받아쓰기의 서수로 기사 시작 시각을 찾고, 앞은 인사·뒤는 정리로 둔다", () => {
  assert.deepEqual(chaptersFromTranscript(BRIEF, 5), [
    { t: 0, rank: null },
    { t: 24, rank: 1 },
    { t: 45, rank: 2 },
    { t: 60, rank: 3 },
    { t: 85, rank: 4 },
    { t: 106, rank: 5 },
    { t: 125, rank: null },
  ]);
});

test("기사 수보다 큰 서수는 무시하고, 서수가 없으면 장이 없다", () => {
  assert.deepEqual(
    chaptersFromTranscript(BRIEF, 3).map((c) => c.rank),
    [null, 1, 2, 3, null]
  );
  assert.deepEqual(chaptersFromTranscript("A: 0:00 안녕하세요\nA: 0:10 오늘 소식입니다", 5), []);
});

test("순서가 어긋난 서수(뒤에서 다시 나온 '첫째')는 버린다", () => {
  const tx = `A: 0:10 첫째 소식\nA: 0:30 둘째 소식\nA: 0:50 첫째 이유는 비용입니다`;
  assert.deepEqual(chaptersFromTranscript(tx, 5), [
    { t: 0, rank: null },
    { t: 10, rank: 1 },
    { t: 30, rank: 2 },
  ]);
});

test("시각 읽기·쓰기", () => {
  assert.equal(parseClock("1:25"), 85);
  assert.equal(parseClock("01:02:03"), 3723);
  assert.equal(parseClock("abc"), null);
  assert.equal(formatClock(139.4), "2:19");
  assert.equal(formatClock(3723), "1:02:03");
  assert.equal(formatClock(Number.NaN), "0:00");
});

test("재생 위치의 장과 기사 시작 시각", () => {
  const ch = chaptersFromTranscript(BRIEF, 5);
  assert.equal(chapterAt(ch, 50)?.rank, 2);
  assert.equal(chapterAt(ch, 5)?.rank, null);
  assert.equal(chapterAt([], 5), null);
  assert.equal(chapterStart(ch, 4), 85);
  assert.equal(chapterStart(ch, 9), null);
});

test("카드 대체 글은 브리핑 데이터로 만든다", () => {
  const alt = cardAltText(
    {
      headline: "딥시크, 두 번째 투자 라운드 1055억 위안",
      top_stories: [
        { rank: 1, title: "딥시크 투자" },
        { rank: 2, title: "애플 중국판 AI" },
      ],
      key_numbers: [{ value: "8시간", label: "샤오미 로봇 연속 작업" }],
    },
    "11월 4일 판 한 장 요약",
    "숫자"
  );
  assert.equal(alt, "11월 4일 판 한 장 요약: 딥시크, 두 번째 투자 라운드 1055억 위안. 1. 딥시크 투자 2. 애플 중국판 AI 숫자: 8시간 샤오미 로봇 연속 작업.");
});

test("행 → 화면용: 주소는 판·언어·종류(+만든 시각), 크기 없는 카드는 뺀다", () => {
  const base = {
    edition_date: "2026-11-04",
    locale: "ko",
    path: "x",
    mime: "audio/mpeg",
    bytes: 1,
    transcript: null,
    alt_text: null,
    source: "notebooklm-brief",
    status: "approved",
    created_at: "2026-11-05 05:00:00+00",
  } as const;
  const set = toMediaSet([
    { ...base, kind: "audio", width: null, height: null, duration_sec: "139.44", chapters: [{ t: 24, rank: 1 }] },
    { ...base, kind: "card", mime: "image/png", width: null, height: null, duration_sec: null, chapters: [] },
  ] as MediaRow[]);
  assert.equal(set.audio?.duration_sec, 139.44);
  assert.match(set.audio!.url, /\/api\/briefing\/media\/2026-11-04\/ko\/audio\?v=\d+$/);
  assert.equal(set.card, undefined);
});
