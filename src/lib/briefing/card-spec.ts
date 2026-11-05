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

export interface BigNumber {
  raw: string;
  label: string;
  /** 퍼센트가 늘었다/줄었다 (기사 글의 바로 뒤 표현으로 코드가 정한다 — bigTrend) */
  dir?: "up" | "down";
  /** 증감이 아닌 퍼센트(0~100) — 비율 미터로 그린다 */
  meter?: number;
}

export interface CardStorySpec {
  rank: number;
  /** 크게 쓸 숫자 (그 기사 문장에 있는 표기 그대로). 없으면 null */
  big: BigNumber | null;
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

export type CardLocale = "ko" | "zh" | "en";
/** 글자 수 제한 — 언어마다 (영어는 같은 뜻에 글자가 두 배쯤 든다). 카드 칸 폭 기준 */
const LIMITS: Record<CardLocale, { label: number; big: number; note: number }> = {
  ko: { label: 14, big: 24, note: 60 },
  zh: { label: 12, big: 20, note: 50 },
  en: { label: 28, big: 44, note: 130 },
};
const lim = (locale: string | undefined) => LIMITS[(locale as CardLocale) in LIMITS ? (locale as CardLocale) : "ko"];

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
export function validateFigure(fig: CardFigure, ground: string, locale: string = "ko"): { ok: true; figure: CardFigure } | { ok: false; reason: string } {
  if (fig.kind === "none") return { ok: true, figure: fig };
  const has = (t: string) => t.length > 0 && ground.includes(t);
  // 라벨은 짧아서 작은 수("3배")도 지어내기 쉽다 — 모든 수(all)로 비교한다
  const groundAll = valueSets(ground).all;
  // 순서·때를 가리키는 말("2차 라운드", "3분기", "12월")은 크기를 말하지 않으므로 빼고 본다
  // zh "第2轮"·"第3季度", en "Q3"·"2nd"·"round 2" 도 같은 뜻
  const ORDINAL = /\d+\s*(차|번째|분기|월|일|위|호|기)(?![가-힣])|第?\d+\s*(轮|季度|月|日|号|名|期|代)|\b[QH]\d\b|\b\d+(st|nd|rd|th)\b|\b(round|phase|gen|No\.)\s*\d+\b/gi;
  const maxLabel = lim(locale).label;
  const labelOk = (l: string) =>
    l.trim().length > 0 && l.length <= maxLabel && [...valueSets(l.replace(ORDINAL, "")).all].every((v) => groundAll.has(v));
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
    // 때가 모두 같으면("December · December") 흐름이 아니다
    if (new Set(fig.items.map((it) => it.when.trim())).size < 2) return { ok: false, reason: "timeline: 때가 모두 같음" };
    return { ok: true, figure: { kind: "timeline", items: fig.items.map((it) => ({ when: it.when, label: it.label.trim() })) } };
  }
  return { ok: false, reason: `모르는 틀 ${(fig as { kind: string }).kind}` };
}

const UP_WORDS = /^(?:\s*(?:이상|가량|정도|넘게|남짓|以上|左右))?\s*(?:늘|증가|상승|올랐|올라|높아|확대|급증|성장|的?(?:增长|增幅|上涨|提升)|(?:year-on-year\s+)?(?:increase|rise|growth|jump|gain))/i;
const DOWN_WORDS = /^(?:\s*(?:이상|가량|정도|넘게|남짓|以上|左右))?\s*(?:줄|감소|하락|낮아|떨어|축소|급감|的?(?:下降|降幅|减少|下滑)|(?:year-on-year\s+)?(?:decrease|decline|drop|fall|cut|reduction))/i;
const UP_BEFORE = /(?:增长|增加|上涨|上升|提升|提高|增幅达?|同比增长)了?(?:约|近|超过|逾)?\s*$|\b(?:rose|rise[sn]?|risen|up|increased?|increasing|grew|grow[sn]?|growth of|jumped|surged|gained)\s+(?:by\s+)?(?:about\s+|nearly\s+|over\s+|more than\s+|roughly\s+)?$|\b(?:raised|increased|boosted|lifted)\b[^.。]{0,30}\bby\s+(?:about\s+|nearly\s+|over\s+|more than\s+|roughly\s+)?$/i;
const DOWN_BEFORE = /(?:下降|减少|下跌|降低|缩减|下滑|降幅达?|同比下降)了?(?:约|近|超过|逾)?\s*$|\b(?:fell|fall[sn]?|fallen|down|decreased?|declined?|dropped|cut|reduced|lowered)\s+(?:by\s+)?(?:about\s+|nearly\s+|over\s+|more than\s+|roughly\s+)?$|\b(?:cut|reduced|lowered|slashed|trimmed)\b[^.。]{0,30}\bby\s+(?:about\s+|nearly\s+|over\s+|more than\s+|roughly\s+)?$/i;

/**
 * 큰 숫자가 퍼센트일 때 그래픽 종류를 코드가 정한다 (LLM 에 맡기지 않음).
 * - 기사 글에서 그 표기 바로 뒤가 "늘었다·증가…" → 증가(up), "줄었다·감소…" → 감소(down)
 * - 증감이 아니고 0~100% → 비율 미터 (전체 중 얼마)
 * - 퍼센트가 아니거나 100% 초과면 아무것도 붙이지 않는다
 */
export function bigTrend(big: { raw: string; label: string }, ground: string): Pick<BigNumber, "dir" | "meter"> {
  const q = oneQuantity(big.raw);
  if (!q || !q.percent) return {};
  const at = ground.indexOf(big.raw);
  const after = at >= 0 ? ground.slice(at + big.raw.length, at + big.raw.length + 24) : "";
  // 중국어·영어는 증감 말이 숫자 앞에 온다 ("增长47%", "rose 47%", "up by 47%")
  const before = at >= 0 ? ground.slice(Math.max(0, at - 48), at) : "";
  const label = big.label;
  if (UP_WORDS.test(after) || UP_BEFORE.test(before) || /(증가|상승|늘어난|성장|增长|增幅|上涨|提升)/.test(label) || /\b(growth|increase|rise|gain)\b/i.test(label)) return { dir: "up" };
  if (DOWN_WORDS.test(after) || DOWN_BEFORE.test(before) || /(감소|하락|줄어든|축소|下降|降幅|减少|下滑)/.test(label) || /\b(decline|drop|decrease|cut|reduction|fall)\b/i.test(label)) return { dir: "down" };
  return q.value > 0 && q.value <= 100 ? { meter: q.value } : {};
}

/** LLM 출력 한 기사 → 검사한 명세. 크게 쓸 숫자·한 줄 설명도 같은 규칙 */
// 영어 수량 표기는 낱말로 시작할 수 있다 ("about 100,000 units", "US$16 billion") — 버전·모델 이름("iOS 27.3", "GPT-5")과 구별
const EN_QTY_START = /^(?:about|nearly|over|more than|up to|around|roughly|approximately|almost|USD|CNY|RMB|HKD|US)\s*\$?\s*\d/i;

export function validateStorySpec(raw: Partial<CardStorySpec>, ground: string, locale: string = "ko"): { spec: CardStorySpec; dropped: string[] } {
  const L = lim(locale);
  const dropped: string[] = [];
  const rank = Number(raw.rank);
  let big: BigNumber | null = raw.big && typeof raw.big.raw === "string" ? { raw: raw.big.raw.trim(), label: String(raw.big.label ?? "").trim() } : null;
  // 크게 쓸 숫자는 크기를 말하는 값이어야 한다 — 버전·모델 이름("iOS 27.3", "GPT-5")은 안 된다
  if (big && (!ground.includes(big.raw) || !/\d/.test(big.raw) || (/^[A-Za-z]/.test(big.raw) && !EN_QTY_START.test(big.raw)) || big.label.length > L.big)) {
    dropped.push(`#${rank} big "${big.raw}"`);
    big = null;
  }
  let figure: CardFigure = { kind: "none" };
  if (raw.figure && typeof raw.figure === "object") {
    const v = validateFigure(raw.figure as CardFigure, ground, locale);
    if (v.ok) figure = v.figure;
    else dropped.push(`#${rank} ${v.reason}`);
  }
  // 큰 숫자와 그림의 관계는 표기("약 1500억 위안" / "1500억 위안")가 아니라 값으로 본다
  const bigQ = big ? oneQuantity(big.raw) : null;
  const sameAsBig = (rawText: string) => {
    if (!big) return false;
    if (rawText === big.raw) return true;
    const q = oneQuantity(rawText);
    return !!(q && bigQ && q.value === bigQ.value && q.currency === bigQ.currency && q.percent === bigQ.percent);
  };
  // 막대: 큰 숫자와 같은 막대에 강조색 (큰 숫자·막대가 같은 것을 가리키게)
  if (big && figure.kind === "bars") {
    const idx = figure.items.findIndex((it) => sameAsBig(it.raw));
    if (idx >= 0) figure = { ...figure, emphasis: idx };
  }
  // 숫자 줄: 큰 숫자와 같은 칸은 빼고(2개 이상 남을 때), 아니면 큰 숫자를 뺀다
  if (big && figure.kind === "chain" && figure.items.some((it) => sameAsBig(it.raw))) {
    const rest = figure.items.filter((it) => !sameAsBig(it.raw));
    if (rest.length >= 2) figure = { kind: "chain", items: rest };
    else big = null;
  }
  if (big) big = { ...big, ...bigTrend(big, ground) };
  let note = String(raw.note ?? "").trim();
  const groundNums = numericValues(ground);
  if (note.length > L.note || [...numericValues(note)].some((n) => !groundNums.has(n))) {
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
    const v = validateStorySpec(raw, storyGround(s, content.key_numbers), meta.locale);
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

/** 언어별 지시 — 규칙은 한국어 지시 하나(CARD_SPEC_SYSTEM)를 쓰고, 글을 쓰는 언어와 글자 수만 덧붙인다 (Gate 2) */
export function cardSpecSystem(locale: string): string {
  if (locale === "zh")
    return `${CARD_SPEC_SYSTEM}

언어: big.label·label·note·unit 은 기사 글과 같은 중국어(간체)로 쓴다. 위 예시의 한국어 낱말을 옮겨 쓰지 말 것.
글자 수(중국어): label 12자, big.label 20자, note 50자 이내. 숫자 표기는 기사 글 그대로("1055亿元", "约10万份").`;
  if (locale === "en")
    return `${CARD_SPEC_SYSTEM}

Language: write big.label, label, note and unit in English, like the article. Do not reuse the Korean words from the examples above.
Length (English): label ≤ 28 characters, big.label ≤ 44, note ≤ 130. Copy number spellings exactly as in the article ("105.5 billion yuan", "about 100,000 units").`;
  return CARD_SPEC_SYSTEM;
}
