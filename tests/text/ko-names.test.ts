import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeKoNames } from "../../src/lib/text/ko-names";
import { glossHanText } from "../../src/lib/briefing/validate";

test("문샷AI: 음차·띄어쓰기·맨 이름을 하나로", () => {
  assert.equal(normalizeKoNames("월지암면, 상장 결승권 진입"), "문샷AI, 상장 결승권 진입");
  assert.equal(normalizeKoNames("월지암(Moonshot AI)발 규칙 재편"), "문샷AI(Moonshot AI)발 규칙 재편");
  assert.equal(normalizeKoNames("문샷 AI 최강 모델"), "문샷AI 최강 모델");
  assert.equal(normalizeKoNames("딥시크와 문샷의 생존법"), "딥시크와 문샷AI의 생존법");
});

test("문샷AI: 받침 조사를 고친다 (이·은·을·과·으로)", () => {
  assert.equal(normalizeKoNames("월지암면이 투자를 받았고 월지암면은 상장, 월지암면을 두고 월지암면과 딥시크"), "문샷AI가 투자를 받았고 문샷AI는 상장, 문샷AI를 두고 문샷AI와 딥시크");
  assert.equal(normalizeKoNames("월지암면으로 옮겼다"), "문샷AI로 옮겼다");
  assert.equal(normalizeKoNames("문샷AI이번 주"), "문샷AI이번 주");
});

test("문샷AI: 멱등", () => {
  const once = normalizeKoNames("문샷AI와 월지암면, 문샷 AI");
  assert.equal(once, "문샷AI와 문샷AI, 문샷AI");
  assert.equal(normalizeKoNames(once), once);
});

test("문샷AI: 한자 사전과 함께 — 문샷(月之暗面) 겹침 없음, 한자 없는 글도 고침 (glossHanText)", () => {
  assert.equal(glossHanText("문샷(月之暗面)이 투자 유치"), "문샷AI가 투자 유치");
  assert.equal(glossHanText("月之暗面 투자"), "문샷AI 투자");
  assert.equal(glossHanText("월지암면 투자"), "문샷AI 투자");
});

test("'월의 어두운 면'(글자대로 옮긴 말)도 문샷AI 로, 받침 조사도 맞춘다", () => {
  assert.equal(normalizeKoNames("월의 어두운 면(Kimi)도 기본 제공"), "문샷AI(Kimi)도 기본 제공");
  assert.equal(normalizeKoNames("월의 어두운 면이 발표했다"), "문샷AI가 발표했다");
});

test("괄호 설명 뒤 조사도 맞춘다", () => {
  assert.equal(normalizeKoNames("월의 어두운 면(Moonshot AI)은 조직을"), "문샷AI(Moonshot AI)는 조직을");
  assert.equal(normalizeKoNames(normalizeKoNames("월의 어두운 면(月之暗面)은 장문")), "문샷AI(月之暗面)는 장문");
});

// ── 2026-11-06 표기 사전(ko-glossary.ts) 전체
test("회사: 한자음 읽기를 한국 언론 표기로, 조사도 맞춘다", () => {
  assert.equal(normalizeKoNames("유수과기, 3분기 매출 69.93% 증가"), "유니트리, 3분기 매출 69.93% 증가");
  assert.equal(normalizeKoNames("유수과기는 상장을 추진하고 유수과기의 매출이"), "유니트리는 상장을 추진하고 유니트리의 매출이");
  assert.equal(normalizeKoNames("상탕이 발표했다"), "센스타임이 발표했다");
  assert.equal(normalizeKoNames("면벽지능 온디바이스 모델"), "모델베스트 온디바이스 모델");
  assert.equal(normalizeKoNames("닝더스다이와 징둥"), "CATL과 징둥");
  assert.equal(normalizeKoNames("비야디가 공개"), "BYD가 공개");
  assert.equal(normalizeKoNames("메이투안을 두고"), "메이퇀을 두고");
  assert.equal(normalizeKoNames("즈지동력은 로봇을"), "LimX Dynamics는 로봇을");
  assert.equal(normalizeKoNames("지푸는 상장"), "즈푸는 상장");
});

test("용어: 피지컬 AI 로 통일, 겹침은 하나로", () => {
  assert.equal(normalizeKoNames("구현지능 물리 AI 임계점"), "피지컬 AI 임계점");
  assert.equal(normalizeKoNames("구현형 AI(임바디드 AI)가 뜬다"), "피지컬 AI가 뜬다");
  assert.equal(normalizeKoNames("체화 지능을 위한 구현형 로봇"), "피지컬 AI를 위한 피지컬 AI 로봇");
  assert.equal(normalizeKoNames("지능체 정책과 출해 기업, 세계 모델"), "AI 에이전트 정책과 해외 진출 기업, 월드 모델");
  assert.equal(normalizeKoNames("대모델을 학습"), "대형 모델을 학습");
  assert.equal(normalizeKoNames("바이두 문심 5.5 공개, 혼원3 정식판"), "바이두 어니 5.5 공개, 훈위안3 정식판");
});

test("다른 낱말은 건드리지 않는다", () => {
  for (const s of [
    "결과를 산출해 냈다", "자료를 제출해 주세요", "지능체계를 갖춘", "지푸라기", "기능을 구현했다", "체화된 경험", "구현된 기능",
    "생산력과 연산력", "종착지", "문샷AI이번 주", "세계 모델링 대회", "문심을 얻다", "인형 로봇들", "단극 체제", "상탕국",
  ]) {
    const out = normalizeKoNames(s);
    if (s === "세계 모델링 대회" || s === "인형 로봇들") continue; // 아래에서 따로 확인
    assert.equal(out, s, s);
  }
  // 3자 이상 표기는 뒤에 무엇이 와도 고친다 (세계 모델링 → 월드 모델링, 인형 로봇들 → 휴머노이드 로봇들)
  assert.equal(normalizeKoNames("세계 모델링 대회"), "월드 모델링 대회");
  assert.equal(normalizeKoNames("인형 로봇들"), "휴머노이드 로봇들");
});

test("표기 사전: 정한 표기는 다시 돌려도 그대로 (멱등), 고칠 표기는 모두 바뀐다", async () => {
  const { KO_GLOSSARY } = await import("../../src/lib/text/ko-glossary");
  for (const e of KO_GLOSSARY) {
    assert.equal(normalizeKoNames(e.ko), e.ko, `canonical ${e.ko}`);
    assert.equal(normalizeKoNames(`${e.ko}의 발표`), `${e.ko}의 발표`, `canonical+의 ${e.ko}`);
    for (const f of e.fix ?? []) {
      const once = normalizeKoNames(`${f}의 발표`);
      assert.equal(once, `${e.ko}의 발표`, `fix ${f} → ${e.ko}`);
      assert.equal(normalizeKoNames(once), once);
    }
  }
});

test("key_terms 한국어 설명도 같은 표기로", async () => {
  const { normalizeKeyTermsKo } = await import("../../src/lib/text/ko-names");
  const out = normalizeKeyTermsKo([{ term: "具身智能", explanation_kr: "구현지능은 몸을 가진 AI입니다." }, "x"]);
  assert.deepEqual(out, [{ term: "具身智能", explanation_kr: "피지컬 AI는 몸을 가진 AI입니다." }, "x"]);
});

test("겹침·원래 이름 밝힘", () => {
  assert.equal(normalizeKoNames("AI 지능체의 복잡한 작업"), "AI 에이전트의 복잡한 작업");
  assert.equal(normalizeKoNames("'아폴로 고(중국명 뤄보콰이파오)'라는 서비스, 뤄보콰이파오의 확장"), "'아폴로 고(중국명 뤄보콰이파오)'라는 서비스, 아폴로 고의 확장");
  assert.equal(normalizeKoNames("체화지능(임바디드 AI)의 핵심"), "피지컬 AI의 핵심");
  assert.equal(normalizeKoNames("두바오와 통이천문"), "더우바오와 큐원");
});
