/**
 * 보정 — AI 검토 결과를 사람 감사(briefing-qa-2026-11-02 JSON)와 비교한다 (순수 함수).
 *
 *  - 사람 오류(라벨 ≠ correct) 하나가 "찾음" = 같은 항목(item)에 검토가 correct 아닌 라벨을 붙였고
 *    주장 글이 겹치거나(글자쌍 Jaccard ≥ 0.12) 그 항목의 사람 오류가 하나뿐일 때. 라벨이 달라도 찾은 것으로 센다(엄격 일치는 따로).
 *  - 거짓 경보 = 검토 오류 중 같은 항목에 사람 오류가 없는 것.
 *  - 항목 경로 표기는 감사마다 달라(bp[1], companies[0], arc[W42]) 정규화한다.
 */
import type { ClaimLabel, ReviewClaim, Verdict } from "./types";

export interface HumanClaim {
  path: string;
  claim_type?: string;
  claim: string;
  label: string;
  evidence?: string;
  note?: string;
}

/** 위치 → 항목 키 (필드 이름은 뺀다: top_stories[1].what → top_stories[1]) */
export function itemKey(path: string): string {
  let p = (path ?? "").trim().replace(/\s+/g, "");
  p = p.replace(/^bp\[/, "big_picture[").replace(/^companies\[/, "companies_to_watch[").replace(/^arc\[[^\]]*\]/, "month_arc");
  p = p.replace(/^month_arc\[\d+\]/, "month_arc");
  p = p.replace(/^(money|china_lens|term)(\[\d+\])?.*$/, "$1");
  const m = p.match(/^(top_stories\[\d+\]|sections\[\d+\]\.items\[\d+\]|key_numbers\[\d+\]|companies_to_watch\[\d+\]|big_picture\[\d+\]|movers\[\d+\]|watch_next\[\d+\]|month_arc|money|china_lens|term|headline|lede|dek|editor_note|term_of_the_day)/);
  return m ? m[1] : p;
}

function bigrams(s: string): Set<string> {
  const t = (s ?? "").replace(/[\s"'“”‘’·,.…()（）\[\]:;!?·~\-—–]/g, "").toLowerCase();
  const out = new Set<string>();
  for (let i = 0; i + 1 < t.length; i++) out.add(t.slice(i, i + 2));
  return out;
}

export function similarity(a: string, b: string): number {
  const A = bigrams(a);
  const B = bigrams(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const x of A) if (B.has(x)) n++;
  return n / Math.min(A.size, B.size);
}

export const MATCH_SIM = 0.12;

export interface EditionComparison {
  edition: string;
  humanErrors: { claim: HumanClaim; found: boolean; exactLabel: boolean; matchedLabel: ClaimLabel | null }[];
  reviewerErrors: { claim: ReviewClaim; matched: boolean }[];
}

export function compareEdition(edition: string, human: HumanClaim[], reviewer: ReviewClaim[], segText: (sid: string) => string = () => ""): EditionComparison {
  const hErr = human.filter((h) => h.label !== "correct");
  const rErr = reviewer.filter((r) => r.label !== "correct");
  const usedR = new Set<number>();
  const perItem = new Map<string, number>();
  for (const h of hErr) perItem.set(itemKey(h.path), (perItem.get(itemKey(h.path)) ?? 0) + 1);
  const humanErrors = hErr.map((h) => {
    const key = itemKey(h.path);
    let best = -1;
    let bestSim = -1;
    rErr.forEach((r, i) => {
      if (itemKey(r.path) !== key) return;
      const sim = Math.max(similarity(h.claim, r.claim), similarity(h.claim, segText(r.sid)), similarity(h.claim, `${r.claim} ${r.note}`));
      if (sim > bestSim) {
        bestSim = sim;
        best = i;
      }
    });
    const found = best >= 0 && (bestSim >= MATCH_SIM || perItem.get(key) === 1);
    if (found) usedR.add(best);
    const matchedLabel = found ? rErr[best].label : null;
    return { claim: h, found, exactLabel: found && matchedLabel === h.label, matchedLabel };
  });
  const hKeys = new Set(hErr.map((h) => itemKey(h.path)));
  const reviewerErrors = rErr.map((r, i) => ({ claim: r, matched: usedR.has(i) || hKeys.has(itemKey(r.path)) }));
  return { edition, humanErrors, reviewerErrors };
}

export interface RecallRow {
  group: string;
  human: number;
  found: number;
  exact: number;
  recall: number | null;
}

const FACT_LABELS = ["wrong", "number-unit", "misattributed", "unsupported"];

export function recallTable(cmps: EditionComparison[]): RecallRow[] {
  const groups: [string, (l: string) => boolean][] = [
    ["사실 오류 (wrong·number-unit·misattributed·unsupported)", (l) => FACT_LABELS.includes(l)],
    ["overclaim", (l) => l === "overclaim"],
    ...FACT_LABELS.map((x) => [x, (l: string) => l === x] as [string, (l: string) => boolean]),
  ];
  return groups.map(([group, f]) => {
    const hs = cmps.flatMap((c) => c.humanErrors).filter((h) => f(h.claim.label));
    const found = hs.filter((h) => h.found).length;
    return { group, human: hs.length, found, exact: hs.filter((h) => h.exactLabel).length, recall: hs.length ? Math.round((found / hs.length) * 1000) / 10 : null };
  });
}

export function falseAlarm(cmps: EditionComparison[]): { reviewerErrors: number; unmatched: number; rate: number | null } {
  const all = cmps.flatMap((c) => c.reviewerErrors);
  const un = all.filter((r) => !r.matched).length;
  return { reviewerErrors: all.length, unmatched: un, rate: all.length ? Math.round((un / all.length) * 1000) / 10 : null };
}

export function confusion(pairs: { human: Verdict; reviewer: Verdict | null }[]): Record<Verdict, Record<Verdict | "ERROR", number>> {
  const z = (): Record<Verdict | "ERROR", number> => ({ PASS: 0, FIXABLE: 0, FAIL: 0, ERROR: 0 });
  const t: Record<Verdict, Record<Verdict | "ERROR", number>> = { PASS: z(), FIXABLE: z(), FAIL: z() };
  for (const p of pairs) t[p.human][p.reviewer ?? "ERROR"]++;
  return t;
}
