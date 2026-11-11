/**
 * 검토 모델 응답(JSON) 스키마 검증 — 모르는 S id·라벨·후보는 버리고 schemaIssues 에 남긴다.
 * 최상위 모양이 틀리면(claims 배열 없음 등) ReviewSchemaError — 그 검토는 error 로 기록되고 판은 자동 발행되지 않는다.
 *
 * 응답 모양 (출력 토큰을 아끼려고 짧은 키):
 *  { "claims": [{ "s": "S01", "c": "주장", "l": "correct|unsupported|wrong|misattributed|overclaim|number-unit",
 *                 "r": "a01,a02", "e": "근거 인용(그대로)", "n": "메모" }],
 *    "fixes": [{ "s": "S05", "a": "replace|delete", "t": "고친 문장", "r": "a03", "e": "근거 인용", "why": "이유" }],
 *    "omissions": [{ "c": "C2", "important": true, "why": "..." }],
 *    "translation": [{ "loc": "en|zh", "s": "S03", "sev": "major|minor", "issue": "..." }],
 *    "readability": [{ "s": "S07", "issue": "..." }],   ← why 쉬움 점검 (v6.4, 판정에 안 들어감)
 *    "structure": ["..."], "verdict": "PASS|FIXABLE|FAIL", "summary": "한 줄" }
 */
import { CLAIM_LABELS, VERDICTS, type ClaimLabel, type ParsedReview, type ReadabilityIssue, type ReviewClaim, type ReviewFix, type ReviewOmission, type Segment, type TranslationIssue, type Verdict } from "./types";

export class ReviewSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewSchemaError";
  }
}

export interface OmissionCandidate {
  cid: string;
  title: string;
  article_ids: string[];
  sources: string[];
  days: string[];
  summary: string;
}

export interface SchemaContext {
  segments: Segment[];
  /** a01 → uuid */
  refLabels: Map<string, string>;
  candidates: OmissionCandidate[];
  claimTypeOf: (path: string) => string;
}

type Obj = Record<string, unknown>;
const s = (v: unknown, max = 600): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const isObj = (v: unknown): v is Obj => Boolean(v) && typeof v === "object" && !Array.isArray(v);

/** "a01, a02" · ["a01"] · "A01" → 라벨 목록 (아는 것만) */
function refsOf(v: unknown, labels: Map<string, string>): string[] {
  const raw = Array.isArray(v) ? v.join(",") : typeof v === "string" ? v : "";
  return [...new Set(raw.split(/[\s,;/]+/).map((x) => x.trim().toLowerCase()).filter((x) => labels.has(x)))];
}

const LABEL_ALIASES: Record<string, ClaimLabel> = {
  number_unit: "number-unit",
  numberunit: "number-unit",
  "number unit": "number-unit",
  misattribution: "misattributed",
  overclaimed: "overclaim",
  incorrect: "wrong",
  supported: "correct",
};

/** 검토 모델이 메모에서 스스로 오류 판정을 거둔 표현 */
export const RETRACTION_RE = /correct\s*(로\s*(재판정|볼\s*수)|에\s*가깝)|실제로는?\s*correct|실질\s*(적인\s*)?오류는?\s*아님|오류가?\s*아님|문제\s*없음\s*$/;

function labelOf(v: unknown): ClaimLabel | null {
  const x = s(v, 40).toLowerCase();
  if ((CLAIM_LABELS as readonly string[]).includes(x)) return x as ClaimLabel;
  return LABEL_ALIASES[x] ?? null;
}

export function parseReviewJson(raw: unknown, ctx: SchemaContext): ParsedReview {
  if (!isObj(raw)) throw new ReviewSchemaError("응답이 JSON 객체가 아님");
  if (!Array.isArray(raw.claims)) throw new ReviewSchemaError("claims 배열이 없음");
  const issues: string[] = [];
  const bySid = new Map(ctx.segments.map((x) => [x.sid, x]));

  const claims: ReviewClaim[] = [];
  raw.claims.forEach((c, i) => {
    if (!isObj(c)) return issues.push(`claims[${i}]: 객체 아님`);
    const sid = s(c.s ?? c.sid, 8).toUpperCase();
    const seg = bySid.get(sid);
    if (!seg) return issues.push(`claims[${i}]: 모르는 문장 id ${sid || "(없음)"}`);
    const label = labelOf(c.l ?? c.label);
    if (!label) return issues.push(`claims[${i}]: 모르는 라벨 ${s(c.l ?? c.label, 30)}`);
    const refs = refsOf(c.r ?? c.ref, ctx.refLabels);
    claims.push({
      sid,
      path: seg.path,
      claim_type: ctx.claimTypeOf(seg.path),
      claim: s(c.c ?? c.claim, 200) || seg.text.slice(0, 200),
      label,
      ref: refs.length ? refs.join(",") : null,
      ref_ids: refs.map((r) => ctx.refLabels.get(r)!),
      evidence: s(c.e ?? c.evidence, 300),
      note: s(c.n ?? c.note, 300),
    });
  });
  // 라벨과 메모가 모순되면(모델이 메모에서 스스로 correct 로 재판정) correct 로 되돌린다 — 보정 v4·v5 에서 2건, 둘 다 실제로 맞는 주장
  for (const c of claims) {
    if (c.label !== "correct" && RETRACTION_RE.test(c.note)) {
      issues.push(`${c.sid}: ${c.label} → correct (메모에서 스스로 철회)`);
      c.note = `[철회: 원래 ${c.label}] ${c.note}`.slice(0, 300);
      c.label = "correct";
    }
  }
  // 주장이 하나도 없는 문장이 있으면 기록만 (모델이 빼먹은 문장)
  const covered = new Set(claims.map((c) => c.sid));
  const missed = ctx.segments.filter((x) => !covered.has(x.sid)).map((x) => x.sid);
  if (missed.length) issues.push(`주장으로 다루지 않은 문장 ${missed.length}개: ${missed.slice(0, 12).join(", ")}`);

  const fixes: ReviewFix[] = [];
  (Array.isArray(raw.fixes) ? raw.fixes : []).forEach((f, i) => {
    if (!isObj(f)) return issues.push(`fixes[${i}]: 객체 아님`);
    const sid = s(f.s ?? f.sid, 8).toUpperCase();
    const seg = bySid.get(sid);
    if (!seg) return issues.push(`fixes[${i}]: 모르는 문장 id ${sid || "(없음)"}`);
    const a = s(f.a ?? f.action, 10).toLowerCase();
    if (a !== "replace" && a !== "delete") return issues.push(`fixes[${i}]: 모르는 동작 ${a}`);
    const refs = refsOf(f.r ?? f.ref, ctx.refLabels);
    fixes.push({
      sid,
      path: seg.path,
      action: a,
      original: seg.text,
      text: a === "replace" ? s(f.t ?? f.text, 600) : "",
      ref: refs.length ? refs.join(",") : null,
      evidence: s(f.e ?? f.evidence, 400),
      reason: s(f.why ?? f.reason, 300),
    });
  });

  const byCid = new Map(ctx.candidates.map((c) => [c.cid, c]));
  const omissions: ReviewOmission[] = [];
  (Array.isArray(raw.omissions) ? raw.omissions : []).forEach((o, i) => {
    if (!isObj(o)) return issues.push(`omissions[${i}]: 객체 아님`);
    const cid = s(o.c ?? o.cid, 8).toUpperCase();
    const cand = byCid.get(cid);
    if (!cand) return issues.push(`omissions[${i}]: 모르는 후보 ${cid || "(없음)"}`);
    if (omissions.some((x) => x.cid === cid)) return;
    omissions.push({ cid, title: cand.title, important: o.important === true, why: s(o.why, 300), article_ids: cand.article_ids, sources: cand.sources.length });
  });

  const translation: TranslationIssue[] = [];
  (Array.isArray(raw.translation) ? raw.translation : []).forEach((t, i) => {
    if (!isObj(t)) return issues.push(`translation[${i}]: 객체 아님`);
    const loc = s(t.loc ?? t.locale, 4).toLowerCase();
    if (loc !== "en" && loc !== "zh") return issues.push(`translation[${i}]: 모르는 언어 ${loc}`);
    const sid = s(t.s ?? t.sid, 8).toUpperCase();
    const path = bySid.get(sid)?.path ?? s(t.path, 80);
    translation.push({ locale: loc, path, severity: s(t.sev ?? t.severity, 8).toLowerCase() === "major" ? "major" : "minor", issue: s(t.issue, 300) });
  });

  // why 쉬움 점검: 주요 기사 why 문장만, 문장당 하나
  const readability: ReadabilityIssue[] = [];
  (Array.isArray(raw.readability) ? raw.readability : []).forEach((x, i) => {
    if (!isObj(x)) return issues.push(`readability[${i}]: 객체 아님`);
    const sid = s(x.s ?? x.sid, 8).toUpperCase();
    const seg = bySid.get(sid);
    if (!seg) return issues.push(`readability[${i}]: 모르는 문장 id ${sid || "(없음)"}`);
    if (!/^top_stories\[\d+\]\.why$/.test(seg.path)) return issues.push(`readability[${i}]: why 문장이 아님 ${seg.path}`);
    const issue = s(x.issue ?? x.n, 200);
    if (!issue || readability.some((r) => r.sid === sid)) return;
    readability.push({ sid, path: seg.path, issue });
  });

  const structure = (Array.isArray(raw.structure) ? raw.structure : []).map((x) => s(x, 300)).filter(Boolean).slice(0, 12);
  const v = s(raw.verdict, 10).toUpperCase();
  const llmVerdict = (VERDICTS as string[]).includes(v) ? (v as Verdict) : null;
  if (!llmVerdict) issues.push(`verdict 없음/모름: ${v || "(없음)"}`);
  return { claims, fixes, omissions, translation, structure, readability, llmVerdict, summary: s(raw.summary, 400), schemaIssues: issues };
}

/** 위치 → 감사 기준표의 claim_type */
export function claimTypeOf(path: string): string {
  if (path === "headline" || path === "lede" || path === "dek" || path === "editor_note") return path;
  const m = path.match(/^top_stories\[\d+\]\.(what|why|title)/);
  if (m) return `top_${m[1]}`;
  if (path.startsWith("sections")) return "section";
  if (path.startsWith("key_numbers")) return "key_number";
  if (path.startsWith("companies_to_watch")) return "company";
  if (path.startsWith("big_picture")) return "big_picture";
  if (path.startsWith("movers")) return "movers";
  if (path.startsWith("money")) return "money";
  if (path.startsWith("china_lens")) return "china_lens";
  if (path.startsWith("watch_next")) return "watch_next";
  if (path.startsWith("month_arc")) return "month_arc";
  if (path.startsWith("term")) return "term";
  return "other";
}
