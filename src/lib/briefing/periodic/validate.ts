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
 * | number_not_in_source          | 치명 | 숫자가 인용 기사·지표 값에 없음 (기간 표기 2026년·10월·11월 1일·W44 는 제외) |
 * | unsupported_entity            | 치명 | 고유명사가 인용 근거에 없음 |
 * | trend_unbacked (신규)          | 치명 | 큰 흐름에 refs 3개 미만이고 지표도 없음 |
 * | volume_wow_unadjusted (신규)   | 치명 | 지난주(지난달) 대비 기사 수 비교에 보정 지표(vol.lfl* / vol.prev_avg_complete_day) 없음 |
 * | volume_week_unadjusted        | 치명 | (월간) 주별 원 건수 비교 |
 * | unknown_week                  | 치명 | (월간) month_arc 의 주 키가 지표에 없음 |
 * | change_unbacked (신규)         | 치명 | "늘었다·줄었다" 에 증감 지표 없음 |
 * | cross_currency_rank (신규)     | 치명 | 통화가 다른 금액의 서열 표현 |
 * | summed_amount                 | 치명 | 금액 합산 표현 |
 * | term_unknown / unknown_entity_key | 치명 | 용어·실체 키가 지표에 없음 |
 * | direction_conflict            | 치명 (2026-11-02) | 하락 지표를 인용하며 상승 표현(또는 반대). 인용하지 않았어도 문장이 그 용어·기업의 언급 증감을 말하면 본다 |
 * | rank_mismatch / rank_unbacked | 치명 | "가장 많이 늘었다·가장 많이 다뤄졌다" 가 지표 1위와 다름 / 대상 지표 없음 |
 * | money_rank / money_not_deal / currency_mismatch / amount_not_in_source | 치명 | 금액 서열·매출을 거래로·원문과 다른 통화·금액 잘라 쓰기 (rules.ts) |
 * | cvo_conflict                  | 치명 | "국내 기업 소식을 주로" 인데 cvo 지표는 해외가 더 많음 |
 * | superlative_unsupported / trend_unsupported / qualifier_dropped / outlet_count / leaked_instruction | 치명 | 데일리와 같은 rules.ts |
 * | metric_relevance (신규)        | 경고 → 수리 호출 대상 | 인용 지표의 대상(기업·매체)이 문장에 없음 |
 * | headline_length               | 치명 → 수리, 그래도 넘으면 결정적 제목 | 제목 상한 초과 (여유 없이 엄격) |
 * | han_in_ko / length            | 치명 (여유 없음) | |
 * | china_centric                 | 치명 | 흐름 4개 중 2개 이상 중국 주체 (rules.ts isChinaSubject: 근거 사건의 subject_region 투표). 수리 뒤에도 미달이면 failed |
 * | top_event_missing             | 경고 → 수리 호출 대상 | 매체 수 1·2위 사건이 본문 어디에도 없음 |
 *
 * 이 파일은 DB 를 import 하지 않는다.
 */
import type { ValidationIssue } from "../types";
import { ENTITIES, entityMentioned, findEntities, properNouns } from "../entities";
import { HAN_RE, NUM_RE, norm } from "../validate";
import { maskGroundedQuantities } from "../quantity";
import {
  claimIssues,
  entityNotInOriginal,
  isChinaSubject,
  leakedInstruction,
  moneyIssues,
  moneyRankIssue,
  outletClaimIssue,
  type SourceDoc,
} from "../rules";
import type { PeriodicValidationReport, PeriodicContent as WeeklyContent } from "./types";

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
  /** 월간: 지표 weeks[].key (month_arc.week 검사) */
  weekKeys?: Set<string>;
  /** S id → 근거 기사(번역 + 중국어 원문). 의미 규칙(rules.ts)용 — 없으면 건너뛴다 */
  docs?: Map<string, SourceDoc[]>;
  /** S id → 매체 이름 */
  outlets?: Map<string, string[]>;
  /** 지표 순위 ("가장 많이 늘었다" 검사): 실체 언급 순, 용어 언급 순, 늘어난 용어 순, 줄어든 용어 순 */
  ranks?: { entities: string[]; terms: string[]; rising: string[]; falling: string[] };
  /** 매체 수 상위 사건(1·2위)의 기사 id, S id → 기사 id (top_event_missing 경고) */
  topEvents?: string[][];
  poolIds?: Map<string, string[]>;
  /** (월간) 주 키 → 기간, S id → 사건 날짜들. month_arc 의 refs 는 그 주의 사건만 (arc_week_mismatch) */
  weekRanges?: Map<string, { start: string; end: string }>;
  sidDays?: Map<string, string[]>;
}

/** 지표 용어(중국어) → 본문에 쓰는 한국어 표기. 방향 검사·순위 검사가 "에이전트 언급이 늘었다" 를 智能体 로 읽게 한다 */
export const TERM_KO: Record<string, string[]> = {
  智能体: ["에이전트", "지능체"],
  具身智能: ["구현형 AI", "구현형 지능", "구현지능", "구현 지능", "체화 지능", "체화지능", "임바디드"],
  算力: ["연산력", "컴퓨팅 파워", "컴퓨팅 자원", "산력"],
  人形机器人: ["휴머노이드", "인간형 로봇"],
  大模型: ["대형 모델", "대모델", "거대 모델"],
  自由现金流: ["잉여현금흐름", "자유현금흐름"],
  开源: ["오픈소스"],
};

/** 문장이 용어(중국어 원어 또는 한국어 표기)를 말하는가 */
export function termMentioned(term: string, text: string): boolean {
  return text.includes(term) || (TERM_KO[term] ?? []).some((k) => text.includes(k));
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
    month_arc: arr(r.month_arc)
      .map((b) => ({ week: str(b.week), text: str(b.text), refs: strArr(b.refs), metrics: strArr(b.metrics) }))
      .filter((b) => b.text),
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
    ...(c.month_arc ?? []).flatMap((b) => b.refs),
  ];
}

function citedMetrics(c: WeeklyContent): string[] {
  return [
    ...c.dek_metrics,
    ...c.big_picture.flatMap((b) => b.metrics),
    ...c.movers.flatMap((b) => b.metrics),
    ...(c.china_lens?.metrics ?? []),
    ...(c.term?.metrics ?? []),
    ...(c.month_arc ?? []).flatMap((b) => b.metrics),
  ];
}

function collectUnits(c: WeeklyContent, headlineMax: number): Unit[] {
  const units: Unit[] = [
    { path: "headline", text: c.headline, refs: [...new Set(citedSids(c))], metrics: [...new Set(citedMetrics(c))], limit: headlineMax, headline: true },
    // 지표만으로 쓴 결정적 대체 dek 은 refs 없이 metrics 로 근거를 단다
    { path: "dek", text: c.dek, refs: c.dek_refs, metrics: c.dek_metrics, limit: 220, noRefsOk: !c.dek_refs.length && c.dek_metrics.length > 0 },
  ];
  (c.month_arc ?? []).forEach((b, i) => units.push({ path: `month_arc[${i}]`, text: b.text, refs: b.refs, metrics: b.metrics, limit: 90 }));
  c.big_picture.forEach((b, i) => units.push({ path: `big_picture[${i}]`, text: `${b.title} ${b.text}`, refs: b.refs, metrics: b.metrics, trend: true, limit: 264 }));
  c.movers.forEach((b, i) => units.push({ path: `movers[${i}]`, text: b.text, refs: b.refs, metrics: b.metrics, limit: 90, subject: b.entity }));
  if (c.money) units.push({ path: "money", text: c.money.text, refs: c.money.refs, metrics: [], limit: 200 });
  if (c.china_lens) units.push({ path: "china_lens", text: c.china_lens.text, refs: c.china_lens.refs, metrics: c.china_lens.metrics, limit: 200 });
  c.watch_next.forEach((w, i) => units.push({ path: `watch_next[${i}]`, text: w.text, refs: w.refs, metrics: [], limit: 70 }));
  if (c.term) units.push({ path: "term", text: c.term.why, refs: [], metrics: c.term.metrics, noRefsOk: true, limit: 80 });
  return units;
}

// ───────────────────────── 의미 규칙 (순수, 단위 테스트 대상)

/** 기간 표기(2026년·10월·11월 1일·W44)는 숫자 검사에서 뺀다 */
export function stripPeriodLabels(text: string): string {
  return text.replace(/20\d{2}년|\d{1,2}월(\s?\d{1,2}일)?|W\d{1,2}\b/g, "");
}

const WOW_RE = /지난주|전주|지난 주|지난달|전월|지난 달/;
const VOLUME_RE = /기사 수|보도량|물량|기사가 (늘|줄)/;
/** 지난주(지난달) 대비 기사 수 비교인데 보정 지표(같은 요일 vol.lfl* / 결손일 뺀 평균 vol.prev_avg_complete_day)를 인용하지 않음 */
export function volumeWowUnadjusted(text: string, metrics: string[]): boolean {
  return WOW_RE.test(text) && VOLUME_RE.test(text) && !metrics.some((k) => k.startsWith("vol.lfl") || k === "vol.prev_avg_complete_day");
}

/** (월간) 주별 원 건수 비교: 주 길이·결손이 달라 평일 평균 지표를 써야 함 */
export function volumeWeekUnadjusted(text: string, metrics: string[]): boolean {
  return (
    /\d+→\d+|주별|주마다/.test(text) &&
    metrics.some((k) => /^week\.W\d+\.total$/.test(k)) &&
    !metrics.some((k) => k.endsWith("weekday_avg"))
  );
}

// 2026-11-02 재감사: W42 헤드라인 '열풍', W41 '확산·몰리는' 이 증감 지표 없이 통과했다 → 증감·쏠림 표현을 넓힌다
const CHANGE_RE = /크게 늘|늘었다|증가했|급증|줄었다|감소했|급감|열풍|(?<![가-힣])붐(?![가-힣])|붐을|쏠림|쏠리|확산(?!\s?(?:방지|억제))|몰리|몰려|몰린/;
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

const UP_RE = /열풍|늘었|늘어|늘고|늘며|증가|확산|급증|쏠림|뛰어들/;
const DOWN_RE = /줄었|줄어|줄고|줄며|감소|식었|급감/;
const splitSentences = (text: string) => text.split(/(?<=[.!?。！？])\s+/).filter((s) => s.trim());

/** 지표의 대상(용어·기업·매체)이 나오는지. 대상이 없는 지표(vol.* 등)는 null */
function metricTargetIn(k: string, sentence: string): boolean | null {
  const [ns, id] = k.split(".");
  if (!id) return null;
  if (ns === "term") return termMentioned(id, sentence);
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
export function directionConflicts(text: string, metrics: string[], facts: Record<string, string>, ground = ""): string[] {
  const out: string[] = [];
  // 언급 수 이야기가 아니고, 증감을 근거 기사의 숫자("호출량 +801%")로 말한 문장은 지표(언급 수)와 다른 사실이다 —
  // 2026-11-02 재감사 W44: '딥시크 호출량 급증'(사실)을 ent.deepseek.chg(언급 −18%)와 충돌로 잡아 수리가 사실을 뒤집었다
  const sentences = splitSentences(text).filter((s) => !sourcedChange(s, ground));
  for (const k of metrics) {
    const v = facts[k] ?? "";
    const neg = k.endsWith(".fall") || (k.endsWith(".chg") && /-\d/.test(v));
    const pos = k.endsWith(".rise") || (k.endsWith(".chg") && /\+\d/.test(v));
    if (!neg && !pos) continue;
    const hit = sentences.filter((s) => metricTargetIn(k, s) === true);
    const scope = hit.length ? hit.join(" ") : sentences.join(" ");
    if (neg && UP_RE.test(scope)) out.push(`${k}=${v} 인데 상승 표현`);
    if (pos && DOWN_RE.test(scope)) out.push(`${k}=${v} 인데 하락 표현`);
  }
  return out;
}

const MENTION_RE = /언급|기사|보도|다뤄|다룬|등장/;

/** 문장의 증감이 근거 기사의 숫자로 뒷받침되나 (언급 이야기가 아니고, 증감 숫자 — %·배 — 가 근거 텍스트에 있음) */
export function sourcedChange(sentence: string, ground: string): boolean {
  if (!ground || MENTION_RE.test(sentence)) return false;
  const nums = sentence.match(/\d[\d,.]*\s?(?:%|배)/g) ?? [];
  const g = norm(ground);
  return nums.some((n) => g.includes(norm(n)));
}
const CLAUSE_SPLIT = /,|，|(?<=[가-힣](?:고|며|지만|으나|는데|반면))\s/;

/**
 * 인용하지 않은 증감 지표와 반대 방향 (2026-11-02 W44 dek "구현형 AI와 에이전트 용어의 언급이 함께 늘었다" — 智能体 84→55).
 * 언급·기사·보도 이야기를 하는 문장에서, 용어(한국어 표기 포함)·기업이 나오는 절의 방향(없으면 다음 절)을 지표와 맞춘다.
 */
export function uncitedDirectionConflicts(text: string, facts: Record<string, string>, cited: string[] = []): string[] {
  const out: string[] = [];
  const keys = Object.keys(facts).filter((k) => /^(term|ent)\..+\.(rise|fall|chg)$/.test(k) && !cited.includes(k));
  for (const s of splitSentences(text)) {
    if (!MENTION_RE.test(s)) continue;
    const clauses = s.split(CLAUSE_SPLIT).filter((c) => c.trim());
    for (const k of keys) {
      const v = facts[k] ?? "";
      const neg = k.endsWith(".fall") || (k.endsWith(".chg") && /-\d/.test(v));
      const pos = k.endsWith(".rise") || (k.endsWith(".chg") && /\+\d/.test(v));
      if (!neg && !pos) continue;
      const i = clauses.findIndex((c) => metricTargetIn(k, c) === true);
      if (i < 0) continue;
      const scope = clauses.slice(i).find((c) => UP_RE.test(c) || DOWN_RE.test(c));
      if (!scope) continue;
      const up = UP_RE.test(scope) && !DOWN_RE.test(scope);
      const down = DOWN_RE.test(scope) && !UP_RE.test(scope);
      if (neg && up) out.push(`${k}=${v} 인데 상승 표현`);
      if (pos && down) out.push(`${k}=${v} 인데 하락 표현`);
    }
  }
  return out;
}

// ───────────────────────── 지표 순위 ("가장 많이 늘었다")

const RISE_TOP_RE = /가장\s?(?:많이|크게)\s?(?:늘|증가)|증가\s?폭이\s?가장|가장 큰 (?:폭|증가)/;
const FALL_TOP_RE = /가장\s?(?:많이|크게)\s?(?:줄|감소)|감소\s?폭이\s?가장/;
const MOST_RE = /가장\s?(?:많이|크게)\s?(?:다뤄|다룬|다뤘|언급|보도|등장|나온|쓰인|쓰였)|언급\s?(?:최다|1위)|최다\s?언급|가장\s?많(?:았|은)/;
/** 순위 표현 (일반 최상급 검사에서는 뺀다 — 지표 순위로 따로 본다) */
export const RANK_PHRASE_RE = new RegExp(`${RISE_TOP_RE.source}|${FALL_TOP_RE.source}|${MOST_RE.source}`, "g");

/**
 * "가장 많이 늘었다·가장 많이 다뤄졌다" 가 지표 1위와 같은가. subjectTerm = term 칸의 용어(문장에 없어도 대상).
 * 대상(용어·기업)이 문장에 없으면 rank_unbacked. ranks 가 없으면 건너뛴다 (단위 테스트·예전 스냅숏).
 */
export function rankIssues(
  text: string,
  ctx: Pick<PeriodicValidationContext, "ranks">,
  subjectTerm?: string,
  subjectEntity?: string
): { rule: string; detail: string }[] {
  const r = ctx.ranks;
  if (!r) return [];
  const out: { rule: string; detail: string }[] = [];
  for (const s of splitSentences(text)) {
    if (!(RISE_TOP_RE.test(s) || FALL_TOP_RE.test(s) || MOST_RE.test(s))) continue;
    const ents = findEntities(s).map((e) => e.key);
    if (subjectEntity && !ents.includes(subjectEntity)) ents.push(subjectEntity);
    const terms = [...new Set([...r.terms, ...r.rising, ...r.falling])].filter((t) => termMentioned(t, s));
    if (subjectTerm && !terms.includes(subjectTerm)) terms.push(subjectTerm);
    if (!terms.length && !ents.length) {
      out.push({ rule: "rank_unbacked", detail: `"${(s.match(RANK_PHRASE_RE) ?? [""])[0]}" — 순위를 뒷받침할 지표 대상(용어·기업)이 문장에 없음` });
      continue;
    }
    const check = (re: RegExp, list: string[], targets: string[], label: string) => {
      const m = s.match(re);
      if (!m || !targets.length) return;
      if (!list.length || !targets.includes(list[0]))
        out.push({ rule: "rank_mismatch", detail: `"${m[0]}" — ${label} 1위는 ${list[0] ?? "(없음)"} (문장: ${targets.join(",")})` });
    };
    check(RISE_TOP_RE, r.rising, terms, "늘어난 용어");
    check(FALL_TOP_RE, r.falling, terms, "줄어든 용어");
    // 용어가 나오면 용어 순위로 ("智能体 21건으로 가장 많이 쓰였다"), 아니면 기업 순위로
    if (MOST_RE.test(s)) {
      if (terms.length) check(MOST_RE, r.terms, terms, "언급 용어");
      else check(MOST_RE, r.entities, ents, "언급 기업");
    }
  }
  return out;
}

// ───────────────────────── 중국 대 해외 구도 (china_lens)

const DOMESTIC_MAIN_RE = /(?:국내|중국)\s?(?:기업|업체|회사)?[^.。]{0,25}(?:주로|중심|대부분|위주|압도)/;
const FOREIGN_MAIN_RE = /해외\s?(?:기업|업체|회사)?[^.。]{0,25}(?:주로|중심|대부분|위주|압도)/;
/** "중국 매체는 국내 기업 소식을 주로 다뤘다" 인데 cvo 지표는 해외 실체 기사가 더 많음 (또는 반대) */
export function cvoConflict(text: string, facts: Record<string, string>): string | null {
  const num = (k: string) => Number((facts[k] ?? "").match(/(\d+(?:\.\d+)?)%/)?.[1] ?? NaN);
  const cn = num("cvo.china");
  const fo = num("cvo.foreign");
  if (!Number.isFinite(cn) || !Number.isFinite(fo)) return null;
  if (DOMESTIC_MAIN_RE.test(text) && !FOREIGN_MAIN_RE.test(text) && cn < fo) return `국내 기업 위주라고 썼지만 중국 ${cn}% < 해외 ${fo}%`;
  if (FOREIGN_MAIN_RE.test(text) && !DOMESTIC_MAIN_RE.test(text) && fo < cn) return `해외 기업 위주라고 썼지만 해외 ${fo}% < 중국 ${cn}%`;
  return null;
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

/** 중국 주체 흐름 수 (데일리와 같은 rules.ts isChinaSubject — S id(사건) 별 근거 기사 subject_region 투표, 미판정이면 실체 규칙) */
export function chinaCentricCount(c: WeeklyContent, ctx?: Pick<PeriodicValidationContext, "docs">): number {
  return c.big_picture.filter((b) => isChinaSubject({ title: b.title, text: b.text }, b.refs.map((r) => ctx?.docs?.get(r) ?? []))).length;
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
    // 같은 값의 금액·큰 수는 표기가 달라도 통과 (quantity.ts — 데일리와 같은 파서)
    for (const m of maskGroundedQuantities(stripPeriodLabels(u.text), groundText).text.match(NUM_RE) ?? []) {
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
      const refGround = u.refs.map((r) => ctx.sourceText.get(r) ?? "").join(" ");
      for (const d of directionConflicts(u.text, u.metrics, F, refGround)) push("fatal", "direction_conflict", u.path, d);
      for (const k of irrelevantMetrics(u.text, u.metrics, ctx.entityNames, u.subject)) push("warn", "metric_relevance", u.path, `${k} 대상이 문장에 없음`);
    }
    // 인용하지 않은 지표와도 방향이 맞아야 한다 (dek·term·china_lens 포함)
    for (const d of uncitedDirectionConflicts(u.text, F, u.metrics)) push("fatal", "direction_conflict", u.path, d);
    for (const i of rankIssues(u.text, ctx, u.path === "term" ? c.term?.term : undefined, u.subject)) push("fatal", i.rule, u.path, i.detail);
    for (const i of periodicSemanticIssues(u, ctx, groundText)) push("fatal", i.rule, u.path, i.detail);
    if (u.path === "china_lens") {
      const cv = cvoConflict(u.text, F);
      if (cv) push("fatal", "cvo_conflict", u.path, cv);
    }
    const han = u.path === "term" ? null : u.text.match(HAN_RE);
    if (han) push("fatal", "han_in_ko", u.path, han.join(""));
    if (u.headline) {
      if (u.text.length > ctx.headlineMax) push("fatal", "headline_length", "headline", `${u.text.length}/${ctx.headlineMax}자`);
    } else if (u.limit && u.text.length > u.limit) push("fatal", "length", u.path, `${u.text.length}/${u.limit}자`);
  }

  if (c.term && !ctx.terms.has(c.term.term)) push("fatal", "term_unknown", "term", c.term.term);
  c.movers.forEach((mv, i) => {
    if (!ctx.entityNames.has(mv.entity)) push("fatal", "unknown_entity_key", `movers[${i}]`, mv.entity);
  });
  if (ctx.weekKeys)
    (c.month_arc ?? []).forEach((b, i) => {
      if (!ctx.weekKeys!.has(b.week)) push("fatal", "unknown_week", `month_arc[${i}]`, b.week || "(없음)");
    });
  // 월간 month_arc: 그 주의 사건만 근거로 (2026-11-02 재감사: W43 문장 근거 16건 중 15건이 W44 S-1 기사)
  (c.month_arc ?? []).forEach((b, i) => {
    const off = arcOffWeekRefs(b, ctx);
    if (off.length) push("fatal", "arc_week_mismatch", `month_arc[${i}]`, `${off.join(",")} 는 ${b.week} 밖의 사건`);
  });
  const cn = chinaCentricCount(c, ctx);
  if (cn < Math.min(2, c.big_picture.length))
    push("fatal", "china_centric", "big_picture", `중국 주체 흐름 ${cn}개 (흐름 ${c.big_picture.length}개 중 2개 이상 필요)`);

  // 매체 수 1·2위 사건이 본문 어디에도 없으면 경고 (QA 권고 16)
  if (ctx.topEvents && ctx.poolIds) {
    const citedIds = new Set(citedSids(c).flatMap((sid) => ctx.poolIds!.get(sid) ?? []));
    ctx.topEvents.forEach((ids, i) => {
      if (ids.length && !ids.some((id) => citedIds.has(id))) push("warn", "top_event_missing", "big_picture", `매체 수 ${i + 1}위 사건이 본문에 없음`);
    });
  }

  return { fatal: dedupe(fatal), warn: dedupe(warn), stats: { bigPicture: c.big_picture.length, chinaCentric: cn, numbersChecked } };
}

/** month_arc 한 칸의 refs 중 그 주에 날짜가 하나도 없는 사건 (주 기간·사건 날짜를 모르면 빈 배열) */
export function arcOffWeekRefs(b: { week: string; refs: string[] }, ctx: Pick<PeriodicValidationContext, "weekRanges" | "sidDays">): string[] {
  const w = ctx.weekRanges?.get(b.week);
  if (!w || !ctx.sidDays) return [];
  return b.refs.filter((r) => {
    const days = ctx.sidDays!.get(r);
    return days !== undefined && !days.some((d) => d >= w.start && d <= w.end);
  });
}

/** 주간·월간 생성 감사 기록 (데일리 validate.ts ContentEdit 와 같은 모양) */
export interface PeriodicEdit {
  action: "trim" | "gloss" | "sentence_delete" | "ref_strip" | "repair" | "drop" | "fallback" | "flip_rejected";
  path: string;
  reason: string;
  before: unknown;
  after: unknown;
  round?: string;
}

/** month_arc 의 주 밖 refs 를 결정적으로 뗀다 (남는 ref 가 없으면 그대로 — 검증이 치명으로 잡아 그 칸을 뺀다) */
export function pruneArcRefs(c: WeeklyContent, ctx: Pick<PeriodicValidationContext, "weekRanges" | "sidDays">): { content: WeeklyContent; edits: PeriodicEdit[] } {
  const out = structuredClone(c);
  const edits: PeriodicEdit[] = [];
  out.month_arc = (out.month_arc ?? []).map((b, i) => {
    const off = arcOffWeekRefs(b, ctx);
    const keep = b.refs.filter((r) => !off.includes(r));
    if (!off.length || !keep.length) return b;
    edits.push({ action: "ref_strip", path: `month_arc[${i}]`, reason: `arc_week_mismatch: ${off.join(",")} 는 ${b.week} 밖`, before: b.refs, after: keep });
    return { ...b, refs: keep };
  });
  return { content: out, edits };
}

// ───────────────────────── 방향 충돌: 사실을 뒤집지 않는다

/** 증감 방향 (+1 상승 / −1 하락 / 0 없음·둘 다) */
function directionOf(s: string): number {
  const up = UP_RE.test(s);
  const down = DOWN_RE.test(s);
  return up === down ? 0 : up ? 1 : -1;
}

/** 칸(항목 위치)의 본문 텍스트 */
export function periodicText(c: WeeklyContent, item: string): string | undefined {
  const m = item.match(/^(big_picture|movers|watch_next|month_arc)\[(\d+)\]$/);
  if (m) return (c[m[1] as "big_picture" | "movers" | "watch_next" | "month_arc"] ?? [])[Number(m[2])]?.text;
  if (item === "money") return c.money?.text;
  if (item === "china_lens") return c.china_lens?.text;
  if (item === "term") return c.term?.why;
  if (item === "dek") return c.dek;
  return undefined;
}

function setPeriodicText(c: WeeklyContent, item: string, v: string): boolean {
  const m = item.match(/^(big_picture|movers|watch_next|month_arc)\[(\d+)\]$/);
  if (m) {
    const x = (c[m[1] as "big_picture" | "movers" | "watch_next" | "month_arc"] ?? [])[Number(m[2])];
    if (!x) return false;
    x.text = v;
    return true;
  }
  if (item === "money" && c.money) c.money.text = v;
  else if (item === "china_lens" && c.china_lens) c.china_lens.text = v;
  else if (item === "term" && c.term) c.term.why = v;
  else if (item === "dek") c.dek = v;
  else return false;
  return true;
}

/**
 * 방향 충돌(direction_conflict)이 난 칸에서 충돌 문장만 지운다 (수리 호출 전, 결정적).
 * 수리에 맡기면 "호출량 급증" 을 "크게 줄었다" 로 뒤집었다 (W44) — 방향을 고쳐 쓰지 않고 그 문장을 뺀다. 문장이 하나뿐이면 그대로 둔다.
 */
export function dropConflictSentences(c: WeeklyContent, fatal: ValidationIssue[], facts: Record<string, string>): { content: WeeklyContent; edits: PeriodicEdit[] } {
  const out = structuredClone(c);
  const edits: PeriodicEdit[] = [];
  for (const f of fatal.filter((x) => x.rule === "direction_conflict")) {
    const item = itemOfPeriodic(f.path);
    const text = periodicText(out, item);
    if (!text) continue;
    const key = f.detail.split("=")[0];
    const sents = splitSentences(text);
    if (sents.length < 2) continue;
    const bad = sents.filter((s) => [...directionConflicts(s, [key], facts), ...uncitedDirectionConflicts(s, facts)].some((d) => d.startsWith(`${key}=`)));
    const keep = sents.filter((s) => !bad.includes(s));
    if (!bad.length || !keep.length) continue;
    const next = keep.join(" ");
    if (setPeriodicText(out, item, next)) edits.push({ action: "sentence_delete", path: item, reason: `direction_conflict: ${f.detail}`, before: text, after: next });
  }
  return { content: out, edits };
}

/**
 * 수리본이 사실을 뒤집었나: 수리 전 문장의 증감 방향과, 같은 대상(고유명사 공유)을 말하는 수리 뒤 문장의 방향이 반대이고,
 * 수리 뒤 문장이 지표 값(FACTS 문자열)을 그대로 인용하지 않았으면 뒤집기. 반환: 뒤집힌 칸 목록.
 */
export function directionFlips(before: WeeklyContent, after: WeeklyContent, facts: Record<string, string>): string[] {
  const items = [
    "dek",
    "money",
    "china_lens",
    "term",
    ...before.big_picture.map((_, i) => `big_picture[${i}]`),
    ...before.movers.map((_, i) => `movers[${i}]`),
    ...(before.month_arc ?? []).map((_, i) => `month_arc[${i}]`),
  ];
  const factValues = Object.values(facts).filter((v) => /\d/.test(v));
  const flipped: string[] = [];
  for (const item of items) {
    const a = periodicText(before, item);
    const b = periodicText(after, item);
    if (!a || !b || a === b) continue;
    const bs = splitSentences(b);
    const hit = splitSentences(a).some((sa) => {
      const da = directionOf(sa);
      if (!da) return false;
      const na = properNouns(sa).map((n) => n.label);
      return bs.some((sb) => {
        const db = directionOf(sb);
        if (!db || db === da) return false;
        return properNouns(sb).some((n) => na.includes(n.label)) && !factValues.some((v) => sb.includes(v));
      });
    });
    if (hit) flipped.push(item);
  }
  return flipped;
}

/** 수리본에서 뒤집힌 칸을 수리 전 문장(충돌 문장은 지운 것)으로 되돌린다 */
export function revertFlips(
  before: WeeklyContent,
  after: WeeklyContent,
  flipped: string[],
  fatal: ValidationIssue[],
  facts: Record<string, string>
): { content: WeeklyContent; edits: PeriodicEdit[] } {
  const base = dropConflictSentences(before, fatal, facts).content;
  const out = structuredClone(after);
  const edits: PeriodicEdit[] = [];
  for (const item of flipped) {
    const orig = periodicText(base, item);
    const repaired = periodicText(out, item);
    if (orig === undefined || repaired === undefined) continue;
    setPeriodicText(out, item, orig);
    edits.push({ action: "flip_rejected", path: item, reason: "수리본이 증감 방향을 뒤집음 (지표 값 인용 없음) — 수리 전 문장으로 되돌림", before: repaired, after: orig });
  }
  return { content: out, edits };
}

/** 단위 하나의 rules.ts 규칙 (데일리와 같은 함수) */
function periodicSemanticIssues(u: Unit, ctx: PeriodicValidationContext, groundText: string): { rule: string; detail: string }[] {
  const out: { rule: string; detail: string }[] = [];
  const leak = leakedInstruction(u.text);
  if (leak) out.push(leak);
  if (u.path === "money") {
    const mr = moneyRankIssue(u.text);
    if (mr) out.push(mr);
  }
  if (!ctx.docs) return out;
  const docs = u.refs.flatMap((r) => ctx.docs!.get(r) ?? []);
  // 지표 값 문자열도 근거 문장으로 넣는다 (금액·최상급 근거)
  const metricDoc: SourceDoc = { title_kr: "", title_cn: "", summary_kr: u.metrics.map((k) => ctx.facts[k] ?? "").join(". "), insight_kr: "" };
  const all = [...docs, metricDoc];
  out.push(...claimIssues(u.text, all, { skip: RANK_PHRASE_RE }));
  out.push(...moneyIssues(u.text, all, groundText));
  if (!u.headline) {
    out.push(...entityNotInOriginal(u.text, docs));
    const oc = outletClaimIssue(u.text, u.refs.flatMap((r) => ctx.outlets?.get(r) ?? []));
    if (oc) out.push(oc);
  }
  return out;
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

/** 수리 대상 경고 (치명은 모두 수리 대상) */
const REPAIR_WARN = ["metric_relevance", "top_event_missing"];

/** 수리 호출이 필요한가: 치명(방향 충돌·제목 길이·한자 포함), 또는 수리 대상 경고 */
export function needsRepair(r: PeriodicValidationReport): boolean {
  return r.fatal.length > 0 || r.warn.some((w) => REPAIR_WARN.includes(w.rule));
}

/** 수리에 넘길 문제 목록 (치명 + 수리 대상 경고) */
export function repairProblems(r: PeriodicValidationReport): ValidationIssue[] {
  return [...r.fatal, ...r.warn.filter((w) => REPAIR_WARN.includes(w.rule))];
}

/** 문장 위치 → 삭제 단위 */
export function itemOfPeriodic(path: string): string {
  const m = path.match(/^(big_picture\[\d+\]|movers\[\d+\]|watch_next\[\d+\]|month_arc\[\d+\]|money|china_lens|term|headline|dek)/);
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
  c.month_arc = (c.month_arc ?? []).filter((_, i) => !items.has(`month_arc[${i}]`));
  if (items.has("money")) c.money = null;
  if (items.has("china_lens")) c.china_lens = null;
  if (items.has("term")) c.term = null;
  const needsFallback = (["headline", "dek"] as const).filter((k) => items.has(k));
  return { content: c, dropped: [...items].filter((i) => i !== "headline" && i !== "dek"), needsFallback };
}
