/**
 * 주간·월간 "한눈에 보기" 칸 (2026-11-10 사용자 결정: 주간·월간도 데일리 개선 반영).
 * 데일리와 같은 부품(BriefingGlance·InfographicCell)에 넣을 칸을 큰 흐름마다 하나씩 만든다 — 큰 숫자는 그 흐름이 인용한
 * 지표(FACTS) 값 문자열 그대로(새 숫자를 만들지 않는다). 순수 함수, DB 없음.
 */
import type { GlanceItem } from "../glance";
import type { PeriodicContent } from "./types";
import { TERM_KO } from "./validate";
import { glossHanText } from "../validate";

const HAN = /[㐀-鿿]/;

/** 지표 값 문자열 → { 이름, 숫자 부분 } ("数据中心 6건→33건" → 데이터센터 / 6건→33건). 숫자가 없으면 null */
export function splitFact(fact: string): { label: string; raw: string } | null {
  const m = fact.match(/^(.*?)\s*((?:약\s*|최대\s*)?[\d.,]+.*)$/);
  if (!m || !/\d/.test(m[2])) return null;
  let label = m[1].trim();
  if (HAN.test(label)) label = TERM_KO[label]?.[0] ?? glossHanText(label);
  if (HAN.test(label)) label = "";
  return { label, raw: m[2].trim() };
}

export function buildPeriodicGlance(c: Pick<PeriodicContent, "big_picture">, facts: Record<string, string>): GlanceItem[] {
  return c.big_picture.map((b, i) => {
    // 생성 단계가 고른 핵심 숫자(검사 통과분)가 먼저, 없으면 그 흐름이 인용한 지표 값
    let big: GlanceItem["big"] = b.key ? { raw: b.key.value, label: b.key.label } : null;
    for (const k of big ? [] : b.metrics) {
      const f = facts[k] ? splitFact(facts[k]) : null;
      if (f) {
        big = { raw: f.raw, label: f.label };
        break;
      }
    }
    return { rank: i + 1, group: null, no: i + 1, section: "trend", title: b.title, big, figure: null, note: "" };
  });
}
