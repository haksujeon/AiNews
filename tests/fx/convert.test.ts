import { test } from "node:test";
import assert from "node:assert/strict";
import { annotateMoney, convertAmountText, fxFootnoteParts, type FxRates } from "../../src/lib/fx/convert";

// 2026-11-05 ECB (Frankfurter) — 1달러 = 6.6684위안 = 1,344.69원
const R: FxRates = { date: "2026-11-05", source: "ECB", perUsd: { USD: 1, CNY: 6.6684, KRW: 1344.69, HKD: 7.8452, JPY: 158.46, EUR: 0.89095 } };

test("한국어: 위안·달러를 원으로", () => {
  assert.equal(annotateMoney("딥시크, 두 번째 투자 라운드 1055억 위안", "ko", R), "딥시크, 두 번째 투자 라운드 1055억 위안(약 21조 3,000억 원)");
  assert.equal(annotateMoney("300억 달러를 모았다", "ko", R), "300억 달러(약 40조 3,000억 원)를 모았다");
  assert.equal(annotateMoney("매출 1.89억 위안", "ko", R), "매출 1.89억 위안(약 381억 원)");
  assert.equal(annotateMoney("토큰 100만 개당 2위안", "ko", R), "토큰 100만 개당 2위안(약 403원)");
  assert.equal(annotateMoney("162억 8,600만 달러", "ko", R), "162억 8,600만 달러(약 21조 9,000억 원)");
});

test("영어: 위안을 달러로, 중국어: 달러를 위안으로", () => {
  assert.equal(annotateMoney("China MaaS market hit 10.6 billion yuan", "en", R), "China MaaS market hit 10.6 billion yuan (about $1.59 billion)");
  assert.equal(annotateMoney("融资300亿美元", "zh", R), "融资300亿美元（约2000亿元）");
});

test("붙이지 않는 자리", () => {
  // 이미 그 언어 통화·%·괄호 안·뒤에 괄호
  assert.equal(annotateMoney("5000억 원 투자, 성장률 69.93%", "ko", R), "5000억 원 투자, 성장률 69.93%");
  assert.equal(annotateMoney("1055억 위안(약 148억 달러)", "ko", R), "1055억 위안(약 148억 달러)");
  assert.equal(annotateMoney("기업가치(300억 달러)", "ko", R), "기업가치(300억 달러)");
  assert.equal(annotateMoney("$15 billion raised", "en", R), "$15 billion raised");
  assert.equal(annotateMoney("1055亿元", "zh", R), "1055亿元");
  // 통화 없는 큰 수
  assert.equal(annotateMoney("파라미터 2800억 개", "ko", R), "파라미터 2800억 개");
  // 환율이 없으면 그대로
  assert.equal(annotateMoney("1055억 위안", "ko", null), "1055억 위안");
});

test("큰 숫자 칸 아래 작은 줄", () => {
  assert.equal(convertAmountText("106억 위안", "ko", R), "약 2조 1,400억 원");
  assert.equal(convertAmountText("10.6 billion yuan", "en", R), "about $1.59 billion");
  assert.equal(convertAmountText("69.93%", "ko", R), null);
  assert.equal(convertAmountText("280B", "ko", R), null);
});

test("각주 환율", () => {
  assert.deepEqual(fxFootnoteParts("ko", R), [{ from: "USD", rate: "1,344.69" }, { from: "CNY", rate: "201.65" }]);
  assert.deepEqual(fxFootnoteParts("en", R), [{ from: "CNY", rate: "0.15" }]);
  assert.deepEqual(fxFootnoteParts("zh", R), [{ from: "USD", rate: "6.6684" }]);
});
