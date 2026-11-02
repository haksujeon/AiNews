/**
 * 수량 표기 정규화 — 숫자 하나를 읽는 규칙 원본 (Gate 2: 파서는 하나).
 *
 * 같은 값을 여러 표기로 쓴다: "162억 8,600만 달러" = "162.86억 달러" = "$16.286B" = "16.286 billion dollars" = "162.86亿美元".
 * 이 파일의 parseQuantities 를 쓰는 곳:
 *  - 번역 재검증 numericValues (translate.ts) — ko 와 en/zh 의 숫자 집합 비교
 *  - 데일리·주간·월간 숫자 검사 (validate.ts / periodic/validate.ts) — 근거 기사에 같은 값의 금액이 있으면 표기가 달라도 통과
 *  - 금액 규칙 amount_not_in_source (rules.ts moneyIssues)
 *  - 주간·월간 돈 흐름 표의 통화별 같은 거래 병합 (metrics/period.ts moneyTable)
 * 2026-11-02 재감사: 10-29 "162억 8,600만 달러" 를 원문 "162.86억 달러" 와 다른 값으로 보고 치명 → Anthropic S-1 이 판에서 사라졌다.
 *
 * 이 파일은 DB 를 import 하지 않는다 (단위 테스트).
 */

export type Currency = "USD" | "CNY" | "HKD" | "KRW" | "JPY" | "EUR";

export interface Quantity {
  /** 정규화 값 (단위 곱한 뒤) */
  value: number;
  currency: Currency | null;
  percent: boolean;
  /** 원문 표기 (앞뒤 공백 없음) */
  raw: string;
  start: number;
  end: number;
  /** 첫 수 (단위 곱하기 전) */
  base: number;
  /** 큰 단위(만·억·亿·billion…)가 붙었나 */
  scaled: boolean;
  /** 소수점 표기 ("8.0", "27.3") — 버전 번호처럼 작은 수도 비교 대상 */
  decimal: boolean;
  /** 라틴 낱말 바로 뒤의 수 ("Genie 4", "GPT-5", "iOS 27") — 이름의 일부라 작은 수도 비교 대상 */
  named: boolean;
}

export const MULT: Record<string, number> = {
  조: 1e12, 兆: 1e12, 万亿: 1e12, trillion: 1e12, tn: 1e12,
  천억: 1e11, 千亿: 1e11, 백억: 1e10, 百亿: 1e10, 십억: 1e9, 十亿: 1e9,
  억: 1e8, 亿: 1e8,
  천만: 1e7, 千万: 1e7, 백만: 1e6, 百万: 1e6,
  만: 1e4, 万: 1e4,
  천: 1e3, 千: 1e3, thousand: 1e3, k: 1e3,
  billion: 1e9, bn: 1e9, b: 1e9,
  million: 1e6, mn: 1e6, m: 1e6,
};

// 통화: 앞 기호($·US$·HK$·¥·RMB·USD) 또는 뒤 낱말(달러·위안·美元·元·yuan·dollars …). 긴 표기부터
const PREFIX = String.raw`(?<pre>US\$|HK\$|\$|¥|￥|RMB\s?|USD\s?|CNY\s?|HKD\s?)?`;
const NUM = String.raw`(?<num>\d[\d,]*(?:\.\d+)?)`;
// 긴 단위부터 (万亿 를 万 + 亿 로 쪼개 읽지 않게). k·B·M 은 낱말 끝일 때만
const UNIT = String.raw`(?<unit>万亿|千亿|百亿|十亿|천억|백억|십억|천만|백만|千万|百万|조|兆|억|亿|만|万|천|千|[Tt]rillion|[Bb]illion|[Mm]illion|[Tt]housand|bn|tn|mn|[kK](?![A-Za-z])|B(?![A-Za-z])|M(?![A-Za-z]))?`;
const PCT = String.raw`(?<pct>%|퍼센트|percent|个百分点)?`;
const SUFFIX = String.raw`(?<suf>홍콩\s?달러|달러|위안|엔화|엔(?![가-힣])|유로|원(?![가-힣])|美元|美金|港元|港币|人民币|元|日元|欧元|韩元|[Uu]\.?[Ss]\.?\s?dollars?|dollars?|yuan|RMB|USD|CNY|HKD)?`;
const TOKEN = new RegExp(`${PREFIX}${NUM}\\s*${UNIT}\\s*${PCT}\\s*${SUFFIX}`, "g");

function currencyOf(pre: string | undefined, suf: string | undefined): Currency | null {
  const p = (pre ?? "").trim();
  const s = (suf ?? "").replace(/\s/g, "");
  if (p === "HK$" || p === "HKD" || /^(홍콩달러|港元|港币|HKD)$/.test(s)) return "HKD";
  if (p === "US$" || p === "$" || p === "USD" || /^(달러|美元|美金|USD)$/i.test(s) || /dollars?$/i.test(s)) return "USD";
  if (p === "¥" || p === "￥" || p === "RMB" || p === "CNY" || /^(위안|人民币|元|yuan|RMB|CNY)$/i.test(s)) return "CNY";
  if (/^(엔|엔화|日元)$/.test(s)) return "JPY";
  if (/^(유로|欧元)$/.test(s)) return "EUR";
  if (/^(원|韩元)$/.test(s)) return "KRW";
  return null;
}

/** 범위 구분자 (~ ～ 〜 - – — 至 到 to) */
const RANGE_RE =
  /(\d[\d,]*(?:\.\d+)?)\s*(~|～|〜|–|—|-|至|到|to)\s*(\d[\d,]*(?:\.\d+)?)\s*(%|퍼센트|percent|万亿|千亿|百亿|十亿|천억|백억|십억|亿|万|억|만|조|兆|[Tt]rillion|[Bb]illion|[Mm]illion)/g;

/**
 * 범위의 뒤쪽 단위를 앞 수에도 붙인다: "7~10%" → "7%~10%", "5~7억" → "5억~7억".
 * "7%至10%" 와 같은 값 집합이 되게 (2026-10-29 zh 오탐: "7~10%" vs "7%至10%").
 */
export function expandRanges(text: string): string {
  return text.replace(RANGE_RE, (_m, a: string, sep: string, b: string, unit: string) => `${a}${unit} ${sep} ${b}${unit}`);
}

/**
 * 텍스트 속 수량. 큰 단위가 이어진 금액("162억 8,600만 달러", "8억 7천만", "5亿3700万", "1조 2000억")은 하나로 합친다.
 * 위치(start/end)는 입력 문자열 기준이다 (범위 확장 전). 범위 비교가 필요하면 호출자가 expandRanges 를 먼저 부른다.
 */
export function parseQuantities(text: string): Quantity[] {
  const out: Quantity[] = [];
  const src = text ?? "";
  for (const m of src.matchAll(TOKEN)) {
    const g = m.groups ?? {};
    const base = Number((g.num ?? "").replace(/,/g, ""));
    if (!Number.isFinite(base)) continue;
    const unitRaw = g.unit ?? "";
    const unit = unitRaw.toLowerCase();
    const mult = unit ? MULT[unit] ?? MULT[unitRaw] ?? 1 : 1;
    const start = m.index ?? 0;
    // 끝 공백은 원문 표기에 넣지 않는다
    const rawFull = m[0];
    const raw = rawFull.trimEnd();
    const end = start + raw.length;
    const cur = currencyOf(g.pre, g.suf);
    const prev = out[out.length - 1];
    const between = prev ? src.slice(prev.end, start) : "";
    // "162억 8,600만" — 앞 수의 단위가 더 크고, 사이가 공백뿐이고, 앞 수에 통화·%가 아직 안 붙었으면 한 수
    const prevMult = prev && prev.scaled ? prev.value / prev.base : 1;
    if (prev && prev.scaled && !prev.currency && !prev.percent && !g.pre && mult >= 1e3 && mult < prevMult && /^\s*$/.test(between)) {
      prev.value += base * mult;
      prev.end = end;
      prev.raw = src.slice(prev.start, end);
      prev.currency = cur;
      prev.percent = Boolean(g.pct);
      continue;
    }
    const before = src.slice(Math.max(0, start - 2), start);
    out.push({
      value: base * mult,
      currency: cur,
      percent: Boolean(g.pct),
      raw,
      start,
      end,
      base,
      scaled: mult > 1,
      decimal: /\./.test(g.num ?? ""),
      named: /[A-Za-z][\s\-]?$/.test(before) && !g.pre,
    });
  }
  return out;
}

/** 비교용 정규화 문자열 (유효 숫자 6자리) */
export const canonicalValue = (v: number) => Number(v.toPrecision(6)).toString();

/** 금액·큰 수의 비교 키: 값 + 통화 (+ %). 통화 없는 큰 수는 통화 칸이 비어 있다 */
export function quantityKey(q: Quantity): string {
  return `${canonicalValue(q.value)}|${q.currency ?? ""}|${q.percent ? "%" : ""}`;
}

/**
 * 근거 텍스트(ground)에 같은 값으로 나오는 금액·큰 수(만 이상 단위 또는 통화가 붙은 수)를 text 에서 가린다.
 * 숫자 토큰 검사(NUM_RE·NUM_UNIT_RE)가 "162억 8,600만 달러" 의 "8,600" 을 근거에 없는 숫자로 잡지 않게 한다.
 * 통화가 한쪽에만 있으면(브리핑 "162억 8,600만", 근거 "162.86억 달러") 값만 같아도 같은 수로 본다.
 * 반환: 가린 텍스트(같은 길이, 가린 자리는 공백)와 가린 표기 목록.
 */
export function maskGroundedQuantities(text: string, ground: string): { text: string; masked: string[] } {
  const qs = parseQuantities(text).filter((q) => q.scaled || q.currency);
  if (!qs.length) return { text, masked: [] };
  const groundQs = parseQuantities(ground);
  const exact = new Set(groundQs.map(quantityKey));
  const byValue = new Map<string, Quantity[]>();
  for (const g of groundQs) {
    const k = canonicalValue(g.value);
    byValue.set(k, [...(byValue.get(k) ?? []), g]);
  }
  let out = text;
  const masked: string[] = [];
  for (const q of qs) {
    const same =
      exact.has(quantityKey(q)) ||
      (byValue.get(canonicalValue(q.value)) ?? []).some((g) => g.percent === q.percent && (!g.currency || !q.currency || g.currency === q.currency) && (g.scaled || g.currency));
    if (!same) continue;
    out = out.slice(0, q.start) + " ".repeat(q.end - q.start) + out.slice(q.end);
    masked.push(q.raw);
  }
  return { text: out, masked };
}

/** 같은 금액이 근거에 있나 (값 + 통화가 같음, 근거의 통화가 없으면 값만) */
export function amountGrounded(raw: string, ground: string): boolean {
  const q = parseQuantities(raw).find((x) => x.scaled || x.currency);
  if (!q) return false;
  return parseQuantities(ground).some(
    (g) => canonicalValue(g.value) === canonicalValue(q.value) && g.percent === q.percent && (g.currency === q.currency || (!g.currency && g.scaled))
  );
}
