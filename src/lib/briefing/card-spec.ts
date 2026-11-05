/**
 * "한 장 요약" 카드의 그림 명세 (INFOGRAPHIC-FORMAL.md 3·5절).
 *
 * 기사마다 그림 틀 하나를 고른다: 같은 단위 막대(bars) · 숫자 사슬(chain) · 일정 줄(timeline) · 큰 숫자만(none).
 * LLM 은 틀과 낱말(라벨)만 고르고, 숫자는 그 기사 문장(title·what·why·key_numbers)에 글자 그대로 있는 것만 쓴다.
 * 코드 검사(validateFigure)를 통과하지 못한 그림은 버리고 큰 숫자만 남긴다 — 카드는 언제나 나간다.
 * 막대 길이는 LLM 이 아니라 수량 파서(quantity.ts parseQuantities, 숫자 검사와 같은 함수)가 계산한다 (Gate 2).
 */
import { parseQuantities, type Quantity } from "./quantity";
import { numericValues, valueSets } from "./translate";
import type { BriefingContent, TopStory } from "./types";

export const CARD_SPEC_VERSION = "card-v1";

export interface BarItem {
  label: string;
  raw: string;
  /** 파서가 계산한 값 (막대 길이). LLM 출력에는 없다 */
  value?: number;
}
export interface ChainItem {
  label: string;
  raw: string;
}
export interface TimelineItem {
  when: string;
  label: string;
}

export type CardFigure =
  | { kind: "bars"; unit: string; items: BarItem[]; emphasis?: number }
  | { kind: "chain"; items: ChainItem[]; emphasis?: number }
  | { kind: "timeline"; items: TimelineItem[] }
  | { kind: "none" };

export interface CardStorySpec {
  rank: number;
  /** 크게 쓸 숫자 (그 기사 문장에 있는 표기 그대로). 없으면 null */
  big: { raw: string; label: string } | null;
  figure: CardFigure;
  /** 한 줄 설명 (60자 이내, 숫자는 기사 문장에 있는 것만) */
  note: string;
}

export interface CardSpec {
  version: string;
  edition_date: string;
  locale: string;
  stories: CardStorySpec[];
  /** 검사에서 버린 것 (기록용) */
  dropped: string[];
}

/** 그 기사에서 숫자를 가져와도 되는 글 */
export function storyGround(s: Pick<TopStory, "title" | "what" | "why" | "refs">, keyNumbers: BriefingContent["key_numbers"]): string {
  const kn = keyNumbers.filter((k) => s.refs.includes(k.ref)).map((k) => `${k.value} ${k.label}`);
  return [s.title, s.what, s.why ?? "", ...kn].join("\n");
}

const MAX_LABEL = 14;
const MAX_NOTE = 60;

/** 표기에서 숫자를 빼고 남은 단위 꼴 ("1055억 위안" → "억위안", "약 1,500억 위안" → "억위안") */
export function unitShape(raw: string): string {
  return raw
    .replace(/^(약|약간|최대|최소|무려|over|about|约|近)\s*/i, "")
    .replace(/[\d.,\s]/g, "")
    .replace(/^(약|约)/, "");
}

function oneQuantity(raw: string): Quantity | null {
  const qs = parseQuantities(raw);
  return qs.length === 1 ? qs[0] : null;
}

/**
 * 그림 하나를 검사한다. 통과하면 막대 값까지 채운 그림, 아니면 버린 이유.
 * - 모든 숫자 표기(raw·when)는 ground 에 글자 그대로 있어야 한다
 * - bars: 2~4개, 표기마다 수량이 하나, 같은 통화·같은 단위 꼴·퍼센트 여부 같음, 값 > 0, 서로 다른 값
 * - chain: 2~4개, 숫자가 있는 표기
 * - timeline: 2~4개, when 이 ground 에 있음, 날짜 순서는 LLM 출력 순서 그대로
 * - 라벨은 14자 이내, 라벨 안의 숫자도 ground 에 있어야 한다
 */
export function validateFigure(fig: CardFigure, ground: string): { ok: true; figure: CardFigure } | { ok: false; reason: string } {
  if (fig.kind === "none") return { ok: true, figure: fig };
  const has = (t: string) => t.length > 0 && ground.includes(t);
  // 라벨은 짧아서 작은 수("3배")도 지어내기 쉽다 — 모든 수(all)로 비교한다
  const groundAll = valueSets(ground).all;
  // 순서·때를 가리키는 말("2차 라운드", "3분기", "12월")은 크기를 말하지 않으므로 빼고 본다
  const ORDINAL = /\d+\s*(차|번째|분기|월|일|위|호|기)(?![가-힣])/g;
  const labelOk = (l: string) =>
    l.trim().length > 0 && l.length <= MAX_LABEL && [...valueSets(l.replace(ORDINAL, "")).all].every((v) => groundAll.has(v));
  const items = (fig as { items?: unknown[] }).items;
  if (!Array.isArray(items) || items.length < 2 || items.length > 4) return { ok: false, reason: `${fig.kind}: 항목 수 ${items?.length ?? 0}` };

  if (fig.kind === "bars") {
    const qs: Quantity[] = [];
    for (const it of fig.items) {
      if (!has(it.raw)) return { ok: false, reason: `bars: 기사에 없는 표기 "${it.raw}"` };
      if (!labelOk(it.label)) return { ok: false, reason: `bars: 라벨 "${it.label}"` };
      const q = oneQuantity(it.raw);
      if (!q || !(q.value > 0)) return { ok: false, reason: `bars: 수량을 읽을 수 없음 "${it.raw}"` };
      qs.push(q);
    }
    const shape = unitShape(fig.items[0].raw);
    if (fig.items.some((it) => unitShape(it.raw) !== shape)) return { ok: false, reason: "bars: 단위가 섞임" };
    if (qs.some((q) => q.currency !== qs[0].currency || q.percent !== qs[0].percent)) return { ok: false, reason: "bars: 통화·퍼센트가 섞임" };
    if (new Set(qs.map((q) => q.value)).size !== qs.length) return { ok: false, reason: "bars: 같은 값이 겹침" };
    const emphasis = typeof fig.emphasis === "number" && fig.emphasis >= 0 && fig.emphasis < fig.items.length ? fig.emphasis : 0;
    return { ok: true, figure: { kind: "bars", unit: fig.unit, emphasis, items: fig.items.map((it, i) => ({ label: it.label.trim(), raw: it.raw, value: qs[i].value })) } };
  }
  if (fig.kind === "chain") {
    for (const it of fig.items) {
      if (!has(it.raw)) return { ok: false, reason: `chain: 기사에 없는 표기 "${it.raw}"` };
      if (!/\d/.test(it.raw)) return { ok: false, reason: `chain: 숫자 없음 "${it.raw}"` };
      if (!labelOk(it.label)) return { ok: false, reason: `chain: 라벨 "${it.label}"` };
    }
    const emphasis = typeof fig.emphasis === "number" && fig.emphasis >= 0 && fig.emphasis < fig.items.length ? fig.emphasis : undefined;
    return { ok: true, figure: { kind: "chain", emphasis, items: fig.items.map((it) => ({ label: it.label.trim(), raw: it.raw })) } };
  }
  if (fig.kind === "timeline") {
    for (const it of fig.items) {
      if (!has(it.when)) return { ok: false, reason: `timeline: 기사에 없는 때 "${it.when}"` };
      if (!labelOk(it.label)) return { ok: false, reason: `timeline: 라벨 "${it.label}"` };
    }
    return { ok: true, figure: { kind: "timeline", items: fig.items.map((it) => ({ when: it.when, label: it.label.trim() })) } };
  }
  return { ok: false, reason: `모르는 틀 ${(fig as { kind: string }).kind}` };
}

/** LLM 출력 한 기사 → 검사한 명세. 크게 쓸 숫자·한 줄 설명도 같은 규칙 */
export function validateStorySpec(raw: Partial<CardStorySpec>, ground: string): { spec: CardStorySpec; dropped: string[] } {
  const dropped: string[] = [];
  const rank = Number(raw.rank);
  let big = raw.big && typeof raw.big.raw === "string" ? { raw: raw.big.raw.trim(), label: String(raw.big.label ?? "").trim() } : null;
  // 크게 쓸 숫자는 크기를 말하는 값이어야 한다 — 버전·모델 이름("iOS 27.3", "GPT-5")은 안 된다
  if (big && (!ground.includes(big.raw) || !/\d/.test(big.raw) || /^[A-Za-z]/.test(big.raw) || big.label.length > 24)) {
    dropped.push(`#${rank} big "${big.raw}"`);
    big = null;
  }
  let figure: CardFigure = { kind: "none" };
  if (raw.figure && typeof raw.figure === "object") {
    const v = validateFigure(raw.figure as CardFigure, ground);
    if (v.ok) figure = v.figure;
    else dropped.push(`#${rank} ${v.reason}`);
  }
  // 큰 숫자와 같은 값을 그림에 또 쓰지 않는다: 숫자 줄에서는 그 칸을 빼고(2개 이상 남을 때), 아니면 큰 숫자를 뺀다
  if (big && figure.kind === "chain" && figure.items.some((it) => it.raw === big!.raw)) {
    const rest = figure.items.filter((it) => it.raw !== big!.raw);
    if (rest.length >= 2) figure = { kind: "chain", items: rest };
    else big = null;
  }
  if (big && figure.kind === "bars" && figure.items.some((it) => it.raw === big!.raw)) big = null;
  let note = String(raw.note ?? "").trim();
  const groundNums = numericValues(ground);
  if (note.length > MAX_NOTE || [...numericValues(note)].some((n) => !groundNums.has(n))) {
    dropped.push(`#${rank} note "${note}"`);
    note = "";
  }
  return { spec: { rank, big, figure, note }, dropped };
}

/** 모든 기사에 대해 (LLM 이 빠뜨린 기사는 큰 숫자 없이) */
export function validateCardSpec(
  content: Pick<BriefingContent, "top_stories" | "key_numbers">,
  llm: { stories?: Partial<CardStorySpec>[] },
  meta: { edition_date: string; locale: string }
): CardSpec {
  const dropped: string[] = [];
  const stories = content.top_stories.map((s) => {
    const raw = (llm.stories ?? []).find((x) => Number(x.rank) === s.rank) ?? { rank: s.rank };
    const v = validateStorySpec(raw, storyGround(s, content.key_numbers));
    dropped.push(...v.dropped);
    return v.spec;
  });
  return { version: CARD_SPEC_VERSION, edition_date: meta.edition_date, locale: meta.locale, stories, dropped };
}

export const CARD_SPEC_SYSTEM = `너는 경제지 그래픽 데스크다. 브리핑의 주요 기사마다 카드에 넣을 그림 하나를 고른다.
반드시 JSON 하나만 출력한다: {"stories":[{"rank":1,"big":{"raw":"…","label":"…"},"figure":{…},"note":"…"}]}

규칙
- 숫자·날짜 표기(raw, when)는 그 기사 글(제목·무슨 일·왜 중요한가·숫자)에 있는 글자를 그대로 복사한다. 계산·반올림·바꿔 쓰기 금지.
- big: 그 기사의 핵심 숫자 하나와 짧은 라벨(24자 이내). 금액·건수·시간·비율처럼 크기를 말하는 값만 (버전·모델 이름 금지). 제목에 이미 있는 숫자보다 제목에 없는 숫자를 우선한다. 없으면 null.
- figure는 아래 중 하나. 억지로 만들지 말고 맞는 것이 없으면 {"kind":"none"}.
  · {"kind":"bars","unit":"억 위안","items":[{"label":"2차 라운드","raw":"1055억 위안"},…],"emphasis":0}
    같은 단위의 숫자 2~4개를 크기로 비교할 때만. 단위·통화가 다르면 쓰지 않는다.
  · {"kind":"chain","items":[{"label":"월 이용권 가격","raw":"0.01위안"},…],"emphasis":2}
    단위가 다른 숫자 2~4개가 한 사건을 함께 설명할 때 (가격·시간·판매량). big 과 같은 숫자는 넣지 않는다.
  · {"kind":"timeline","items":[{"when":"11월 4일","label":"개발자 테스트"},{"when":"12월","label":"정식 배포"}]}
    날짜·시점이 2~4개 있을 때. 시간 순서대로.
- label은 14자 이내 명사구. label 안에 숫자를 새로 만들지 않는다.
- note: 그림 아래 한 줄(60자 이내). 기사 글에 있는 사실만. 과장(폭발·완판·대체) 금지.
- 기사마다 하나씩, rank 순서대로.`;

export function buildCardSpecUser(content: Pick<BriefingContent, "top_stories" | "key_numbers">): string {
  return content.top_stories
    .map((s) => `### rank ${s.rank}\n${storyGround(s, content.key_numbers)}`)
    .join("\n\n");
}
