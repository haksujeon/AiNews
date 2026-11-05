/**
 * "한눈에 보기" 블록 (사용자 결정 2026-11-05, 안 A): 목차·숫자로 보는 하루·한 장 요약을 한 블록으로.
 * 칸마다 분야·제목·핵심 숫자(+작은 그림). 숫자와 그림은 한 장 요약 카드와 같은 명세(card-spec.ts)를 쓴다 (Gate 2).
 * 명세가 없는 판(zh·en, 카드 생성 전·실패)은 그 기사의 "숫자로 보는 하루" 값으로 채운다 — 빈칸 없음.
 */
import type { CardFigure, CardSpec } from "./card-spec";
import type { BriefingContent } from "./types";

export interface GlanceItem {
  rank: number;
  section: string;
  title: string;
  big: { raw: string; label: string } | null;
  figure: CardFigure | null;
}

export function buildGlance(c: Pick<BriefingContent, "top_stories" | "key_numbers">, spec: CardSpec | null | undefined): GlanceItem[] {
  // 판을 다시 만들어 기사 수가 달라졌으면 옛 명세는 쓰지 않는다
  if (spec && spec.stories.length !== c.top_stories.length) spec = null;
  return c.top_stories.map((s) => {
    const sp = spec?.stories.find((x) => x.rank === s.rank);
    const kn = c.key_numbers.find((k) => s.refs.includes(k.ref));
    const big = sp?.big ?? (kn ? { raw: kn.value, label: kn.label } : null);
    const figure = sp && sp.figure.kind !== "none" ? sp.figure : null;
    return { rank: s.rank, section: s.section, title: s.title, big, figure };
  });
}
