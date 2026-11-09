/**
 * "한눈에 보기" 블록 (사용자 결정 2026-11-05, 안 A): 목차·숫자로 보는 하루·한 장 요약을 한 블록으로.
 * 칸마다 분야·제목·핵심 숫자(+작은 그림). 숫자와 그림은 한 장 요약 카드와 같은 명세(card-spec.ts)를 쓴다 (Gate 2).
 * 명세가 없는 판(zh·en, 카드 생성 전·실패)은 그 기사의 "숫자로 보는 하루" 값으로 채운다 — 빈칸 없음.
 */
import type { BigNumber, CardFigure, CardSpec } from "./card-spec";
import type { BriefingContent } from "./types";
import { displayNo, isGrouped, type StoryGroup } from "./story-groups";

export interface GlanceItem {
  rank: number;
  /** 묶음 (2026-11-09~ 판: 중국 cn · 해외 intl). 예전 판은 null — 한 목록 */
  group: StoryGroup | null;
  /** 보이는 번호 (묶음 안 순서, 예전 판은 rank) — story-groups.ts displayNo */
  no: number;
  section: string;
  title: string;
  /** 증감(dir)·비율 미터(meter)는 카드 명세가 있을 때만 (명세 없는 판의 숫자로 보는 하루 값은 숫자만) */
  big: BigNumber | null;
  figure: CardFigure | null;
  /** 한 줄 설명 (카드 명세의 note). 없으면 "" */
  note: string;
}

export function buildGlance(c: Pick<BriefingContent, "top_stories" | "key_numbers">, spec: CardSpec | null | undefined): GlanceItem[] {
  // 판을 다시 만들어 기사 수가 달라졌으면 옛 명세는 쓰지 않는다
  if (spec && spec.stories.length !== c.top_stories.length) spec = null;
  const grouped = isGrouped(c.top_stories);
  return c.top_stories.map((s) => {
    const sp = spec?.stories.find((x) => x.rank === s.rank);
    const kn = c.key_numbers.find((k) => s.refs.includes(k.ref));
    const big = sp?.big ?? (kn ? { raw: kn.value, label: kn.label } : null);
    const figure = sp && sp.figure.kind !== "none" ? sp.figure : null;
    return { rank: s.rank, group: grouped ? s.group ?? null : null, no: displayNo(s, c.top_stories), section: s.section, title: s.title, big, figure, note: sp?.note ?? "" };
  });
}
