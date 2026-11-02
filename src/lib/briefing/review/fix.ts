/**
 * 자동 수정 계획 — 검토 모델의 문장 단위 수정안을 "근거가 확인될 때만" 받아들인다 (순수 함수).
 *
 * 원칙: 새 사실을 만들지 않는다.
 *  - 고칠 대상은 검토에서 correct 가 아닌 라벨이 붙은 문장뿐이다 (correct 문장에 붙은 수정안은 버린다).
 *  - replace 는 다음을 모두 만족할 때만: 근거 인용이 그 문장의 인용 기사(주간·월간은 FACTS 포함) 본문에 그대로 있다,
 *    새 문장의 숫자는 모두 근거 인용에 있거나(원문 문장의 숫자 중 기사에도 있는 것은 유지 허용),
 *    로마자 낱말·한글 글자쌍이 원문 문장·인용·기사에서 왔다, 근거에 없는 최상급을 덧붙이지 않는다, 길이가 크게 늘지 않는다.
 *    misattributed(근거 기사가 틀림)는 refs 를 고치지 않으므로 replace 하지 않고 지운다.
 *  - 그 밖(수정안 없음·근거 미확인)은 그 문장을 지운다.
 * 적용(applySegmentEdits)과 재검증(결정적 검사기)은 호출하는 쪽(pipeline)이 한다.
 */
import type { ReviewClaim, ReviewFix, Segment } from "./types";
import type { SegmentEdit } from "./segments";
import { KEY_NUMBER_SEP } from "./segments";

/** 인용 대조용 정규화: 공백·문장부호·따옴표를 지우고 소문자 */
export function normQuote(s: string): string {
  return (s ?? "")
    .replace(/[\s"'`“”‘’「」『』《》〈〉<>·・,，.。…~～\-–—_()（）[\]{}【】:：;；!！?？、|/\\*#]/g, "")
    .toLowerCase();
}

const quoteParts = (quote: string) =>
  (quote ?? "")
    .split(/…|\.\.\.|⋯/)
    .map(normQuote)
    .filter((p) => p.length >= 4);

/** 인용이 근거 본문에 그대로 있는가. "…"·"..." 로 생략한 인용은 조각마다 확인 (조각 4자 이상) */
export function quoteFound(quote: string, corpus: string): boolean {
  const parts = quoteParts(quote);
  if (!parts.length) return false;
  if (parts.reduce((n, p) => n + p.length, 0) < 6) return false;
  const hay = normQuote(corpus);
  return parts.every((p) => hay.includes(p));
}

/** 가장 긴 공통 부분 문자열 길이 (a 는 짧은 인용, b 는 근거 본문) */
function longestCommon(a: string, b: string): number {
  let best = 0;
  let prev = new Uint16Array(a.length + 1);
  let cur = new Uint16Array(a.length + 1);
  for (let j = 1; j <= b.length; j++) {
    const bj = b.charCodeAt(j - 1);
    for (let i = 1; i <= a.length; i++) {
      cur[i] = a.charCodeAt(i - 1) === bj ? prev[i - 1] + 1 : 0;
      if (cur[i] > best) best = cur[i];
    }
    [prev, cur] = [cur, prev];
  }
  return best;
}

/** 근사 일치 하한: 조각마다 가장 긴 공통 부분이 조각 길이의 이 비율 이상 */
export const FUZZY_QUOTE_MIN = 0.8;

/**
 * 인용 확인 수준: exact(그대로) | fuzzy(한두 낱말만 다름 — 조각마다 공통 부분 ≥ 80%, 인용의 숫자는 모두 본문에 있음) | none.
 * 검토 모델은 긴 입력에서 인용을 옮길 때 낱말 하나를 바꿔 쓰는 일이 있다 (10-27 v7: 融资→上市). 숫자는 근사를 허용하지 않는다.
 */
export function quoteMatch(quote: string, corpus: string): "exact" | "fuzzy" | "none" {
  if (quoteFound(quote, corpus)) return "exact";
  const parts = quoteParts(quote);
  if (!parts.length || parts.reduce((n, p) => n + p.length, 0) < 8) return "none";
  const hay = normQuote(corpus);
  const flatCorpus = (corpus ?? "").replace(/,/g, "");
  const numsOk = numberTokens(quote).every((n) => flatCorpus.includes(n));
  if (!numsOk) return "none";
  return parts.every((p) => longestCommon(p, hay) >= Math.ceil(p.length * FUZZY_QUOTE_MIN)) ? "fuzzy" : "none";
}

/** 숫자 토큰 (쉼표 제거, 끝 마침표 제거). 1 자리 정수도 포함 — 수정은 엄격하게 */
export function numberTokens(text: string): string[] {
  return [...(text ?? "").matchAll(/\d[\d,]*(?:\.\d+)?/g)].map((m) => m[0].replace(/,/g, "").replace(/\.$/, ""));
}

const latinWords = (t: string) => [...(t ?? "").matchAll(/[A-Za-z][A-Za-z0-9+\-.]*[A-Za-z0-9]|[A-Za-z]{2,}/g)].map((m) => m[0].toLowerCase());
const hangulBigrams = (t: string) => {
  const out: string[] = [];
  for (const w of (t ?? "").match(/[가-힣]+/g) ?? []) for (let i = 0; i + 1 < w.length; i++) out.push(w.slice(i, i + 2));
  return out;
};
const SUPERLATIVE_RE = /최초|최대|최고|역대|사상\s?최|유일|가장|첫\s|1위|급증|폭증|폭등|급락/g;

/** 한글 글자쌍 중 원문 문장·인용·기사에서 온 비율의 하한 */
export const MIN_BIGRAM_COVERAGE = 0.85;

export interface FixCheck {
  ok: boolean;
  reasons: string[];
}

/**
 * replace 수정안 하나를 근거와 대조한다.
 * corpus = 그 문장의 인용 기사 본문(+FACTS). quote 는 그 corpus 안에 그대로 있어야 한다.
 */
export function checkReplacement(original: string, replacement: string, quote: string, corpus: string, opts: { keyNumber?: boolean } = {}): FixCheck {
  const reasons: string[] = [];
  const t = (replacement ?? "").replace(/\s+/g, " ").trim();
  if (!t) reasons.push("고친 문장이 비어 있음");
  if (normQuote(t) === normQuote(original)) reasons.push("원문과 같음");
  if (t.length > Math.max(original.length * 1.6, original.length + 40)) reasons.push("길이가 크게 늘어남");
  if (!quote?.trim()) reasons.push("근거 인용 없음");
  else if (quoteMatch(quote, corpus) === "none") reasons.push("근거 인용이 인용 기사에 없음");
  if (opts.keyNumber && !t.includes(KEY_NUMBER_SEP.trim())) reasons.push("숫자 항목 형식(값 — 설명) 아님");

  const qNums = new Set(numberTokens(quote));
  const corpusFlat = (corpus ?? "").replace(/,/g, "");
  const keepNums = new Set(numberTokens(original).filter((n) => new RegExp(`(?<![\\d.])${n.replace(/\./g, "\\.")}(?![\\d])`).test(corpusFlat)));
  const badNums = numberTokens(t).filter((n) => !qNums.has(n) && !keepNums.has(n));
  if (badNums.length) reasons.push(`근거에 없는 숫자: ${[...new Set(badNums)].join(", ")}`);

  const pool = `${original} ${quote} ${corpus}`.toLowerCase();
  const badLatin = latinWords(t).filter((w) => !pool.includes(w));
  if (badLatin.length) reasons.push(`근거에 없는 로마자 낱말: ${[...new Set(badLatin)].slice(0, 5).join(", ")}`);

  const grams = hangulBigrams(t);
  if (grams.length) {
    const poolGrams = new Set(hangulBigrams(pool));
    const cov = grams.filter((g) => poolGrams.has(g)).length / grams.length;
    if (cov < MIN_BIGRAM_COVERAGE) reasons.push(`근거에 없는 표현 비율이 높음 (글자쌍 일치 ${Math.round(cov * 100)}%)`);
  }
  const sup = [...new Set(t.match(SUPERLATIVE_RE) ?? [])].filter((w) => !quote.includes(w));
  if (sup.length) reasons.push(`근거 인용에 없는 최상급·강조: ${sup.join(", ")}`);
  return { ok: reasons.length === 0, reasons };
}

export interface PlannedFix {
  sid: string;
  path: string;
  action: "replace" | "delete";
  original: string;
  text: string;
  /** 왜 이 동작인가 (수정안 채택 / 근거 미확인으로 삭제 / 수정안 없음으로 삭제) */
  basis: "reviewer_replace" | "reviewer_delete" | "rejected_replace_deleted" | "no_fix_deleted";
  labels: string[];
  evidence: string;
  rejected?: string[];
}

export interface FixPlan {
  edits: SegmentEdit[];
  planned: PlannedFix[];
  /** 수정안이 correct 문장을 가리켜 버린 것 */
  ignored: { sid: string; reason: string }[];
}

/**
 * corpusOf(seg, fix) = 그 문장(또는 수정안이 가리킨 기사 중 그 문장의 refs 안에 있는 것)의 근거 본문.
 */
export function planFixes(
  segments: Segment[],
  claims: ReviewClaim[],
  fixes: ReviewFix[],
  corpusOf: (seg: Segment, refIds: string[]) => string
): FixPlan {
  const bySid = new Map(segments.map((s) => [s.sid, s]));
  const flagged = new Map<string, Set<string>>();
  for (const c of claims) {
    if (c.label === "correct") continue;
    if (!flagged.has(c.sid)) flagged.set(c.sid, new Set());
    flagged.get(c.sid)!.add(c.label);
  }
  const planned: PlannedFix[] = [];
  const ignored: FixPlan["ignored"] = [];
  const fixBySid = new Map<string, ReviewFix>();
  for (const f of fixes) {
    if (!flagged.has(f.sid)) {
      ignored.push({ sid: f.sid, reason: "검토에서 문제로 표시되지 않은 문장" });
      continue;
    }
    if (!fixBySid.has(f.sid)) fixBySid.set(f.sid, f);
  }
  for (const [sid, labelSet] of flagged) {
    const seg = bySid.get(sid);
    if (!seg) continue;
    const labels = [...labelSet];
    const f = fixBySid.get(sid);
    if (f?.action === "replace" && !labels.includes("misattributed")) {
      const refIds = claims.filter((c) => c.sid === sid).flatMap((c) => c.ref_ids);
      const corpus = corpusOf(seg, refIds);
      const chk = checkReplacement(seg.text, f.text, f.evidence, corpus, { keyNumber: seg.path.startsWith("key_numbers[") });
      if (chk.ok) {
        planned.push({ sid, path: seg.path, action: "replace", original: seg.text, text: f.text.replace(/\s+/g, " ").trim(), basis: "reviewer_replace", labels, evidence: f.evidence });
        continue;
      }
      planned.push({ sid, path: seg.path, action: "delete", original: seg.text, text: "", basis: "rejected_replace_deleted", labels, evidence: f.evidence, rejected: chk.reasons });
      continue;
    }
    planned.push({
      sid, path: seg.path, action: "delete", original: seg.text, text: "",
      basis: f?.action === "delete" ? "reviewer_delete" : labels.includes("misattributed") && f ? "rejected_replace_deleted" : "no_fix_deleted",
      labels, evidence: f?.evidence ?? "", rejected: labels.includes("misattributed") && f?.action === "replace" ? ["misattributed 는 refs 를 고치지 않으므로 삭제"] : undefined,
    });
  }
  planned.sort((a, b) => a.sid.localeCompare(b.sid));
  return { edits: planned.map((p) => ({ sid: p.sid, action: p.action, text: p.text || undefined })), planned, ignored };
}
