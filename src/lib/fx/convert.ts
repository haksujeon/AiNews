/**
 * 금액 환산 표기 (2026-11-06 사용자 결정): 화면에서 금액 옆에 그 언어 나라 돈으로 바꾼 값을 함께 쓴다.
 *   ko → 원(KRW), en → 달러(USD), zh → 위안(CNY). 바꿀 통화: 위안·달러·홍콩달러·엔·유로·원 중 그 언어 통화가 아닌 것 모두.
 *   환율 = ECB 기준(Frankfurter), 판·기사 날짜 기준(그날이 휴일이면 직전 영업일) — fx/store.ts.
 *
 * 저장된 글(판 content·기사)은 바꾸지 않는다. 화면에 보낼 때만 붙인다 (fx/briefing.ts withFxNotes) —
 * 숫자 검사(근거 기사 대조)·음성 원고·카드 그림은 원래 금액만 본다.
 * 금액 읽기는 quantity.ts parseQuantities 하나 (Gate 2: 숫자 파서는 하나).
 *
 * 이 파일은 DB 를 import 하지 않는다 (단위 테스트).
 */
import { parseQuantities, type Currency, type Quantity } from "../briefing/quantity";

export type FxLocale = "ko" | "en" | "zh";

/** 1달러 = 몇 그 통화 (USD = 1) */
export interface FxRates {
  date: string;
  source: string;
  perUsd: Record<Currency, number>;
}

export const FX_TARGET: Record<FxLocale, Currency> = { ko: "KRW", en: "USD", zh: "CNY" };

/** 유효숫자 3자리 */
const sig3 = (v: number) => (v === 0 ? 0 : Number(v.toPrecision(3)));
const comma = (n: number) => Math.round(n).toLocaleString("en-US");

/** 원: "21조 3,000억 원" · "5억 8,300만 원" · "3만 9,000원" · "390원" */
function formatKrw(v: number): string {
  const x = sig3(v);
  if (x < 1e4) return `${comma(x)}원`;
  const jo = Math.floor(x / 1e12);
  const eok = Math.floor((x % 1e12) / 1e8);
  const man = Math.floor((x % 1e8) / 1e4);
  const parts: string[] = [];
  if (jo) parts.push(`${comma(jo)}조`);
  if (eok) parts.push(`${comma(eok)}억`);
  if (man && !jo) parts.push(`${comma(man)}만`);
  const rest = !jo && !eok ? Math.round(x % 1e4) : 0;
  return rest ? `${parts.join(" ")} ${comma(rest)}원` : `${parts.join(" ")} 원`;
}

/** 달러: "$15.8 billion" · "$12.3 million" · "$4,560" · "$0.45" */
function formatUsd(v: number): string {
  const x = sig3(v);
  const n = (d: number) => Number((x / d).toPrecision(3)).toString();
  if (x >= 1e12) return `$${n(1e12)} trillion`;
  if (x >= 1e9) return `$${n(1e9)} billion`;
  if (x >= 1e6) return `$${n(1e6)} million`;
  if (x >= 1) return `$${comma(x)}`;
  return `$${x.toFixed(2)}`;
}

/** 위안: "2.13万亿元" · "2000亿元" · "15.8万元" · "390元" */
function formatCny(v: number): string {
  const x = sig3(v);
  const n = (d: number) => Number((x / d).toPrecision(3)).toString();
  if (x >= 1e12) return `${n(1e12)}万亿元`;
  if (x >= 1e8) return `${n(1e8)}亿元`;
  if (x >= 1e4) return `${n(1e4)}万元`;
  if (x >= 10) return `${Math.round(x)}元`;
  return `${x.toFixed(2)}元`;
}

const FORMAT: Record<FxLocale, (v: number) => string> = { ko: formatKrw, en: formatUsd, zh: formatCny };
const WRAP: Record<FxLocale, (s: string) => string> = { ko: (s) => `(약 ${s})`, en: (s) => ` (about ${s})`, zh: (s) => `（约${s}）` };

/** 금액 하나를 그 언어 통화로 (환산 대상이 아니면 null). "약"·괄호 없이 값만 */
export function convertQuantity(q: Pick<Quantity, "value" | "currency" | "percent">, locale: FxLocale, rates: FxRates | null): string | null {
  if (!rates || !q.currency || q.percent || !(q.value > 0)) return null;
  const to = FX_TARGET[locale];
  if (q.currency === to) return null;
  const from = rates.perUsd[q.currency];
  const target = rates.perUsd[to];
  if (!from || !target) return null;
  return FORMAT[locale]((q.value / from) * target);
}

/** 금액 표기 하나("106억 위안")의 환산 값 — 큰 숫자 칸 아래 작은 줄용. 금액이 아니면 null */
export function convertAmountText(raw: string, locale: FxLocale, rates: FxRates | null): string | null {
  const qs = parseQuantities(raw).filter((q) => q.currency);
  if (qs.length !== 1) return null;
  const v = convertQuantity(qs[0], locale, rates);
  return v ? (locale === "ko" ? `약 ${v}` : locale === "zh" ? `约${v}` : `about ${v}`) : null;
}

/**
 * 글 속 금액마다 환산 값을 괄호로 붙인다 (순수). 붙이지 않는 경우:
 *  - 괄호 안의 금액 ("(약 148억 달러)" — 이미 다른 통화로 밝힌 자리)
 *  - 바로 뒤에 괄호가 있는 금액 ("1055억 위안(약 148억 달러)")
 *  - 범위의 앞 금액 ("100~200억 위안" 의 100) — 뒤 금액에만 붙인다
 *  - 이미 그 언어 통화이거나 % 인 것
 */
export function annotateMoney(text: string, locale: FxLocale, rates: FxRates | null): string {
  if (!text || !rates) return text;
  const qs = parseQuantities(text);
  let out = text;
  // 뒤에서부터 넣어야 앞 위치가 흔들리지 않는다
  for (const q of [...qs].reverse()) {
    if (!q.currency) continue;
    const before = text.slice(0, q.start);
    const open = (before.match(/[(（]/g) ?? []).length - (before.match(/[)）]/g) ?? []).length;
    if (open > 0) continue;
    const next = text.slice(q.end, q.end + 2);
    if (/^\s?[(（]/.test(next)) continue;
    if (/^\s?[~～\-–]\s?\d/.test(next)) continue;
    const v = convertQuantity(q, locale, rates);
    if (!v) continue;
    out = out.slice(0, q.end) + WRAP[locale](v) + out.slice(q.end);
  }
  return out;
}

/** 각주 한 줄의 환율 값들 (그 언어 통화 1단위 기준이 아니라, 사람이 익숙한 쪽: 1달러 = 1,344.69원 · 1위안 = 201.65원) */
export function fxFootnoteParts(locale: FxLocale, rates: FxRates): { from: Currency; rate: string }[] {
  const to = FX_TARGET[locale];
  const froms: Currency[] = locale === "ko" ? ["USD", "CNY"] : locale === "en" ? ["CNY"] : ["USD"];
  return froms
    .filter((f) => f !== to && rates.perUsd[f] && rates.perUsd[to])
    .map((f) => {
      const r = rates.perUsd[to] / rates.perUsd[f];
      const rate = r >= 100 ? r.toLocaleString("en-US", { maximumFractionDigits: 2 }) : r.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
      return { from: f, rate };
    });
}
