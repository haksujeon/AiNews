/** 로봇 기업 이름표(로봇 범위 v3) — 별칭이 맞게 걸리고, 겹치는 낱말에는 걸리지 않는지 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { findEntities, isChineseSubject, maxEntityTier } from "../../src/lib/briefing/entities";

const keys = (t: string) => findEntities(t).map((e) => e.key);

test("로봇 기업: 중국어·한국어·영문 표기가 같은 실체로 잡힌다 (등급 0.5)", () => {
  assert.ok(keys("优必选发布Thinker cosmos").includes("ubtech"));
  assert.ok(keys("유비테크, 휴머노이드 사전 예약 3,000대 돌파").includes("ubtech"));
  assert.ok(keys("智元机器人目标 2027 年实现 100 亿营收").includes("agibot"));
  assert.ok(keys("宇树、智元的线下门店叙事").includes("agibot"));
  assert.ok(keys("유니트리·즈위안, 오프라인 매장").includes("agibot"));
  assert.ok(keys("银河通用拉着英伟达").includes("galbot"));
  assert.ok(keys("何小鹏：小鹏 IRON 机器人预计 Q3 亮相").includes("xpeng_iron"));
  assert.ok(keys("보스턴 다이내믹스 경영진 대규모 퇴진").includes("boston_dynamics"));
  assert.ok(keys("Figure 03 휴머노이드, 200시간 완전 자율 작업").includes("figure_ai"));
  assert.ok(keys("以30%成本跑赢 Figure AI 45%效率").includes("figure_ai"));
  assert.ok(keys("1X Technologies opens NEO preorders").includes("1x"));
  assert.ok(keys("傅利叶发布新一代人形机器人").includes("fourier"));
  assert.equal(maxEntityTier("优必选上榜《财富》"), 0.5);
  assert.ok(isChineseSubject("Galbot 신규 투자 유치"));
  assert.equal(isChineseSubject("Boston Dynamics Atlas 공개"), false);
});

test("옵티머스는 테슬라 실체로 센다 (별도 키 없음)", () => {
  assert.deepEqual(keys("테슬라 옵티머스 양산 점검"), ["tesla"]);
  assert.deepEqual(keys("Optimus V3 hands demo"), ["tesla"]);
  assert.equal(maxEntityTier("Optimus 생산 확대"), 0.6);
});

test("겹치는 낱말에는 걸리지 않는다", () => {
  // 매체 新智元 은 智元(AgiBot) 이 아니다
  assert.deepEqual(keys("据新智元报道，模型发布"), []);
  assert.deepEqual(keys("银河系外行星"), []);
  assert.deepEqual(keys("푸리에 변환으로 신호 분석"), []);
  assert.deepEqual(keys("한정판 피규어 출시"), []);
  assert.deepEqual(keys("Figure 3 shows the results"), []);
  assert.deepEqual(keys("IRON 등급 보상"), []);
  assert.deepEqual(keys("NVIDIA RTX Spark N1X 슈퍼칩"), ["nvidia"]);
  assert.deepEqual(keys("2X 속도, 1X 재생"), []);
});
