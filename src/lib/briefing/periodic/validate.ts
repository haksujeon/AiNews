/**
 * 주간(·월간) 리포트 결정적 검증 — 설계 검토서 §3.5.
 *
 * 데일리 validate.ts 의 숫자 정규식(NUM_RE·norm)·한자 검사(HAN_RE)·고유명사(properNouns) 를 그대로 쓰고,
 * 지표(FACTS) 인용 규칙과 의미 규칙 6개를 더한다.
 *
 * | 규칙                          | 등급 | 내용 |
 * |-------------------------------|------|------|
 * | schema                        | 치명 | 필수 필드 |
 * | missing_refs / unknown_ref    | 치명 | 근거 기사 없음 / 없는 S id |
 * | unknown_metric                | 치명 | FACTS 에 없는 지표 키 |
 * | number_not_in_source          | 치명 | 숫자가 인용 기사·지표 값에 없음 (기간 표기 10월·11월 1일·W44 는 제외) |
 * | unsupported_entity            | 치명 | 고유명사가 인용 근거에 없음 |
 * | trend_unbacked (신규)          | 치명 | 큰 흐름에 refs 3개 미만이고 지표도 없음 |
 * | volume_wow_unadjusted (신규)   | 치명 | 지난주 대비 기사 수 비교에 같은 요일 지표(vol.lfl*) 없음 |
 * | volume_week_unadjusted        | 치명 | (월간) 주별 원 건수 비교 |
 * | change_unbacked (신규)         | 치명 | "늘었다·줄었다" 에 증감 지표 없음 |
 * | cross_currency_rank (신규)     | 치명 | 통화가 다른 금액의 서열 표현 |
 * | summed_amount                 | 치명 | 금액 합산 표현 |
 * | term_unknown / unknown_entity_key | 치명 | 용어·실체 키가 지표에 없음 |
 * | direction_conflict (신규)      | 경고 → 수리 호출 대상 | 하락 지표를 인용하며 상승 표현(또는 반대) |
 * | metric_relevance (신규)        | 경고 | 인용 지표의 대상(기업·매체)이 문장에 없음 |
 * | headline_length               | 경고 → 수리 호출 대상 | 제목 상한 초과 (여유 없이 엄격) |
 * | han_in_ko / length / china_centric | 경고 | |
 *
 * 이 파일은 DB 를 import 하지 않는다.
 */
import type { ValidationIssue } from "../types";
import { ENTITIES, entityMentioned, properNouns } from "../entities";
import { HAN_RE, NUM_RE, norm } from "../validate";
import type { PeriodicValidationReport, WeeklyContent } from "./types";

export interface PeriodicValidationContext {
  kind: "weekly" | "monthly";
  /** S id → 근거 텍스트 (묶음 기사 전체의 제목·요약·인사이트·중국어 제목) */
  sourceText: Map<string, string>;
  /** 지표 키 → 표시 문자열 (buildFacts) */
  facts: Record<string, string>;
  /** 지표에 있는 실체 key → 한국어 이름 */
  entityNames: Map<string, string>;
  /** 지표 상위 용어 */
  terms: Set<string>;
  headlineMax: number;
}

// ───────────────────────── 정규화

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : typeof v === "string" && v ? [v.trim()] : []);
const arr = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Record<string, unknown>[]) : [];
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

export function normalizeWeekly(raw: unknown): { content: WeeklyContent; issues: ValidationIssue[] } {
  const r = obj(raw) ?? {};
  const money = obj(r.money);
  const lens = obj(r.china_lens);
  const term = obj(r.term);
  const content: WeeklyContent = {
    headline: str(r.headline),
    dek: str(r.dek),
    dek_refs: strArr(r.dek_refs),
    dek_metrics: strArr(r.dek_metrics),
    big_picture: arr(r.big_picture).map((b) => ({ title: str(b.title), text: str(b.text), refs: strArr(b.refs), metrics: strArr(b.metrics) })),
    movers: arr(r.movers).map((b) => ({ entity: str(b.entity), text: str(b.text), refs: strArr(b.refs), metrics: strArr(b.metrics) })),
    money: money && str(money.text) ? { text: str(money.text), refs: strArr(money.refs) } : null,
    china_lens: lens && str(lens.text) ? { text: str(lens.text), refs: strArr(lens.refs), metrics: strArr(lens.metrics) } : null,
    watch_next: arr(r.watch_next).map((b) => ({ text: str(b.text), refs: strArr(b.refs) })).filter((w) => w.text),
    term: term && str(term.term) ? { term: str(term.term), why: str(term.why), metrics: strArr(term.metrics) } : null,
  };
  const issues: ValidationIssue[] = [];
  if (!content.headline) issues.push({ level: "fatal", rule: "schema", path: "headline", detail: "headline 없음" });
  if (!content.dek) issues.push({ level: "fatal", rule: "schema", path: "dek", detail: "dek 없음" });
  content.big_picture.forEach((b, i) => {
    if (!b.title || !b.text) issues.push({ level: "fatal", rule: "schema", path: `big_picture[${i}]`, detail: "title/text 없음" });
  });
  return { content, issues };
}

// ───────────────────────── 검사 단위

interface Unit {
  path: string;
  text: string;
  refs: string[];
  metrics: string[];
  trend?: boolean;
  limit?: number;
  noRefsOk?: boolean;
  /** headline: 자체 refs 가 없어 본문 전체 refs·지표로 숫자·실체만 본다 */
  headline?: boolean;
  /** movers: 이 문장의 주체 실체 */
  subject?: string;
}

/** 본문에서 인용한 모든 S id */
export function citedSids(c: WeeklyContent): string[] {
  return [
    ...c.dek_refs,
    ...c.big_picture.flatMap((b) => b.refs),
    ...c.movers.flatMap((b) => b.refs),
    ...(c.money?.refs ?? []),
    ...(c.china_lens?.refs ?? []),
    ...c.watch_next.flatMap((w) => w.refs),
  ];
}

function citedMetrics(c: WeeklyContent): string[] {
  return [
    ...c.dek_metrics,
    ...c.big_picture.flatMap((b) => b.metrics),
    ...c.movers.flatMap((b) => b.metrics),
    ...(c.china_lens?.metrics ?? []),
    ...(c.term?.metrics ?? []),
  ];
}

function collectUnits(c: WeeklyContent, headlineMax: number): Unit[] {
  const units: Unit[] = [
    { path: "headline", text: c.headline, refs: [...new Set(citedSids(c))], metrics: [...new Set(citedMetrics(c))], limit: headlineMax, headline: true },
    // 지표만으로 쓴 결정적 대체 dek 은 refs 없이 metrics 로 근거를 단다
    { path: "dek", text: c.dek, refs: c.dek_refs, metrics: c.dek_metrics, limit: 220, noRefsOk: !c.dek_refs.length && c.dek_metrics.length > 0 },
  ];
  c.big_picture.forEach((b, i) => units.push({ path: `big_picture[${i}]`, text: `${b.title} ${b.text}`, refs: b.refs, metrics: b.metrics, trend: true, limit: 264 }));
  c.movers.forEach((b, i) => units.push({ path: `movers[${i}]`, text: b.text, refs: b.refs, metrics: b.metrics, limit: 90, subject: b.entity }));
  if (c.money) units.push({ path: "money", text: c.money.text, refs: c.money.refs, metrics: [], limit: 200 });
  if (c.china_lens) units.push({ path: "china_lens", text: c.china_lens.text, refs: c.china_lens.refs, metrics: c.china_lens.metrics, limit: 200 });
  c.watch_next.forEach((w, i) => units.push({ path: `watch_next[${i}]`, text: w.text, refs: w.refs, metrics: [], limit: 70 }));
  if (c.term) units.push({ path: "term", text: c.term.why, refs: [], metrics: c.term.metrics, noRefsOk: true, limit: 80 });
  return units;
}

// ───────────────────────── 의미 규칙 (순수, 단위 테스트 대상)

/** 기간 표기(10월·11월 1일·W44)는 숫자 검사에서 뺀다 */
export function stripPeriodLabels(text: string): string {
  return text.replace(/\d{1,2}월(\s?\d{1,2}일)?|W\d{1,2}\b/g, "");
}

const WOW_RE = /지난주|전주|지난 주/;
const VOLUME_RE = /기사 수|보도량|물량|기사가 (늘|줄)/;
/** 지난주 대비 기사 수 비교인데 같은 요일 지표(vol.lfl*)를 인용하지 않음 */
export function volumeWowUnadjusted(text: string, metrics: string[]): boolean {
  return WOW_RE.test(text) && VOLUME_RE.test(text) && !metrics.some((k) => k.startsWith("vol.lfl"));
}

/** (월간) 주별 원 건수 비교: 주 길이·결손이 달라 평일 평균 지표를 써야 함 */
export function volumeWeekUnadjusted(text: string, metrics: string[]): boolean {
  return (
    /\d+→\d+|주별|주마다/.test(text) &&
    metrics.some((k) => /^week\.W\d+\.total$/.test(k)) &&
    !metrics.some((k) => k.endsWith("weekday_avg"))
  );
}

const CHANGE_RE = /크게 늘|늘었다|증가했|급증|줄었다|감소했|급감/;
const CHANGE_METRIC_RE = /\.(rise|fall|chg)$|^week\.|^vol\.lfl/;
/** 증감 주장인데 증감 지표가 없음 */
export function changeUnbacked(text: string, metrics: string[]): boolean {
  return CHANGE_RE.test(text) && !metrics.some((k) => CHANGE_METRIC_RE.test(k));
}

const RANK_RE = /가장 큰|최대 규모|가장 많은/;
/** 위안과 달러 금액을 한 문장에서 서열로 비교 */
export function crossCurrencyRank(text: string): boolean {
  return RANK_RE.test(text) && /위안/.test(text) && /달러/.test(text);
}

const UP_RE = /열풍|늘었|늘어|증가|확산|급증|쏠림|뛰어들/;
const DOWN_RE = /줄었|줄어|감소|식었|급감/;
const splitSentences = (text: string) => text.split(/(?<=[.!?。！？])\s+/).filter((s) => s.trim());

/** 지표의 대상(용어·기업·매체)이 나오는지. 대상이 없는 지표(vol.* 등)는 null */
function metricTargetIn(k: string, sentence: string): boolean | null {
  const [ns, id] = k.split(".");
  if (!id) return null;
  if (ns === "term") return sentence.includes(id);
  if (ns === "ent") {
    const e = ENTITIES.find((x) => x.key === id);
    return e ? entityMentioned(e, sentence) : null;
  }
  if (ns === "src") return sentence.includes(id);
  return null;
}

/**
 * 인용 지표의 방향과 문장 표현의 방향이 반대. 지표 대상이 나오는 문장만 보고,
 * 대상이 어느 문장에도 없으면(예: 智能体 를 인용하고 "개인 에이전트 열풍" 이라고만 씀) 항목 전체를 본다.
 */
export function directionConflicts(text: string, metrics: string[], facts: Record<string, string>): string[] {
  const out: string[] = [];
  const sentences = splitSentences(text);
  for (const k of metrics) {
    const v = facts[k] ?? "";
    const neg = k.endsWith(".fall") || (k.endsWith(".chg") && /-\d/.test(v));
    const pos = k.endsWith(".rise") || (k.endsWith(".chg") && /\+\d/.test(v));
    if (!neg && !pos) continue;
    const hit = sentences.filter((s) => metricTargetIn(k, s) === true);
    const scope = hit.length ? hit.join(" ") : text;
    if (neg && UP_RE.test(scope)) out.push(`${k}=${v} 인데 상승 표현`);
    if (pos && DOWN_RE.test(scope)) out.push(`${k}=${v} 인데 하락 표현`);
  }
  return out;
}

/** 인용 지표의 대상(기업·매체)이 문장에 없음. 용어는 한국어 번역어 사전(v2) 전까지 보지 않는다 */
export function irrelevantMetrics(text: string, metrics: string[], entityNames: Map<string, string>, subject = ""): string[] {
  const out: string[] = [];
  for (const k of metrics) {
    const [ns, id] = k.split(".");
    if (ns === "ent") {
      if (id === subject) continue;
      const e = ENTITIES.find((x) => x.key === id);
      const named = entityNames.get(id);
      if (e && !entityMentioned(e, text) && !(named && text.includes(named))) out.push(k);
    } else if (ns === "src" && id && !text.includes(id)) out.push(k);
  }
  return out;
}

const CN_SUBJECT_RE = /중국|베이징|상하이|항저우|선전/;
export function chinaCentricCount(c: WeeklyContent): number {
  return c.big_picture.filter((b) => {
    const t = `${b.title} ${b.text}`;
    return CN_SUBJECT_RE.test(t) || ENTITIES.some((e) => e.chinese && entityMentioned(e, t));
  }).length;
}

// ───────────────────────── 본 검증

export function validateWeekly(c: WeeklyContent, ctx: PeriodicValidationContext, preIssues: ValidationIssue[] = []): PeriodicValidationReport {
  const fatal: ValidationIssue[] = preIssues.filter((i) => i.level === "fatal");
  const warn: ValidationIssue[] = preIssues.filter((i) => i.level === "warn");
  const F = ctx.facts;
  let numbersChecked = 0;
  const push = (level: "fatal" | "warn", rule: string, path: string, detail: string) =>
    (level === "fatal" ? fatal : warn).push({ level, rule, path, detail });

  for (const u of collectUnits(c, ctx.headlineMax)) {
    if (!u.text) continue;
    if (!u.headline) {
      if (!u.refs.length && !u.noRefsOk) push("fatal", "missing_refs", u.path, "근거 기사 없음");
      for (const r of u.refs) if (!ctx.sourceText.has(r)) push("fatal", "unknown_ref", u.path, `존재하지 않는 id ${r}`);
      for (const k of u.metrics) if (!(k in F)) push("fatal", "unknown_metric", u.path, `지표 키 ${k} 없음`);
    }
    if (u.trend && u.refs.length < 3 && u.metrics.length < 1)
      push("fatal", "trend_unbacked", u.path, `refs ${u.refs.length}개, metrics 0개`);

    const groundText = [...u.refs.map((r) => ctx.sourceText.get(r) ?? ""), ...u.metrics.map((k) => F[k] ?? "")].join(" ");
    const pool = norm(groundText);
    for (const m of stripPeriodLabels(u.text).match(NUM_RE) ?? []) {
      numbersChecked++;
      const n = norm(m).replace(/[.]+$/, "");
      if (n && !pool.includes(n)) push("fatal", "number_not_in_source", u.path, `"${m}" 가 인용 기사·지표에 없음`);
    }
    for (const p of properNouns(u.text)) if (!p.matches(groundText)) push("fatal", "unsupported_entity", u.path, p.label);

    if (volumeWowUnadjusted(u.text, u.metrics)) push("fatal", "volume_wow_unadjusted", u.path, "수집 미완 날짜 보정 없는 물량 비교");
    if (ctx.kind === "monthly" && volumeWeekUnadjusted(u.text, u.metrics))
      push("fatal", "volume_week_unadjusted", u.path, "주 길이·수집 미완이 다른 주별 원 건수 비교");
    if (crossCurrencyRank(u.text)) push("fatal", "cross_currency_rank", u.path, "통화가 다른 금액의 서열 표현");
    if (changeUnbacked(u.text, u.metrics)) push("fatal", "change_unbacked", u.path, "증감 주장에 증감 지표 없음");
    if (/합계|총\s?\d|모두 합쳐|합산/.test(u.text)) push("fatal", "summed_amount", u.path, "금액 합산 표현");

    if (!u.headline) {
      for (const d of directionConflicts(u.text, u.metrics, F)) push("warn", "direction_conflict", u.path, d);
      for (const k of irrelevantMetrics(u.text, u.metrics, ctx.entityNames, u.subject)) push("warn", "metric_relevance", u.path, `${k} 대상이 문장에 없음`);
    }
    const han = u.path === "term" ? null : u.text.match(HAN_RE);
    if (han) push("warn", "han_in_ko", u.path, han.join(""));
    if (u.headline) {
      if (u.text.length > ctx.headlineMax) push("warn", "headline_length", "headline", `${u.text.length}/${ctx.headlineMax}자`);
    } else if (u.limit && u.text.length > Math.round(u.limit * 1.15)) push("warn", "length", u.path, `${u.text.length}/${u.limit}자`);
  }

  if (c.term && !ctx.terms.has(c.term.term)) push("fatal", "term_unknown", "term", c.term.term);
  c.movers.forEach((mv, i) => {
    if (!ctx.entityNames.has(mv.entity)) push("fatal", "unknown_entity_key", `movers[${i}]`, mv.entity);
  });
  const cn = chinaCentricCount(c);
  if (cn < Math.min(2, c.big_picture.length)) push("warn", "china_centric", "big_picture", `중국 주체 흐름 ${cn}개`);

  return { fatal: dedupe(fatal), warn: dedupe(warn), stats: { bigPicture: c.big_picture.length, chinaCentric: cn, numbersChecked } };
}

function dedupe(list: ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>();
  return list.filter((i) => {
    const k = `${i.rule}|${i.path}|${i.detail}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** 수리 호출이 필요한가: 치명, 방향 충돌, 제목 길이, 한자 */
export function needsRepair(r: PeriodicValidationReport): boolean {
  return r.fatal.length > 0 || r.warn.some((w) => ["direction_conflict", "headline_length", "han_in_ko"].includes(w.rule));
}

/** 수리에 넘길 문제 목록 (치명 + 수리 대상 경고) */
export function repairProblems(r: PeriodicValidationReport): ValidationIssue[] {
  return [...r.fatal, ...r.warn.filter((w) => ["direction_conflict", "headline_length", "han_in_ko", "metric_relevance"].includes(w.rule))];
}

/** 문장 위치 → 삭제 단위 */
export function itemOfPeriodic(path: string): string {
  const m = path.match(/^(big_picture\[\d+\]|movers\[\d+\]|watch_next\[\d+\]|money|china_lens|term|headline|dek)/);
  return m ? m[1] : path;
}

/**
 * 남은 치명 항목을 결정적으로 뺀다. headline·dek 는 뺄 수 없어 needsFallback 으로 돌려준다 (호출자가 결정적 문장으로 대체).
 */
export function dropFatalPeriodic(
  content: WeeklyContent,
  fatal: ValidationIssue[]
): { content: WeeklyContent; dropped: string[]; needsFallback: ("headline" | "dek")[] } {
  const items = new Set(fatal.map((f) => itemOfPeriodic(f.path)));
  const c: WeeklyContent = structuredClone(content);
  c.big_picture = c.big_picture.filter((_, i) => !items.has(`big_picture[${i}]`));
  c.movers = c.movers.filter((_, i) => !items.has(`movers[${i}]`));
  c.watch_next = c.watch_next.filter((_, i) => !items.has(`watch_next[${i}]`));
  if (items.has("money")) c.money = null;
  if (items.has("china_lens")) c.china_lens = null;
  if (items.has("term")) c.term = null;
  const needsFallback = (["headline", "dek"] as const).filter((k) => items.has(k));
  return { content: c, dropped: [...items].filter((i) => i !== "headline" && i !== "dek"), needsFallback };
}
