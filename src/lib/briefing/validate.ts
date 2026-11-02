/**
 * 브리핑 결정적 검증 — 설계 검토서 §3.6 (프로토타입 validate.py 의 TS 이식 + 보강).
 *
 * | 규칙                                   | 등급 |
 * |----------------------------------------|------|
 * | schema: 필수 필드·모양                  | 치명 |
 * | unknown_ref: refs 가 입력 id 안에 있음   | 치명 |
 * | missing_refs: 모든 항목에 refs ≥ 1       | 치명 |
 * | excluded_or_hidden_ref: 제외·숨김 기사 인용 | 치명 |
 * | number_not_in_source: 숫자가 인용 기사에 있음 | 치명 |
 * | number_unit_not_in_source: 숫자+단위("2위") | 치명 |
 * | term: 용어가 ref 기사 key_terms 에 있고 병음 일치 | 치명 |
 * | refs_relevance: 고유명사가 각 ref 기사에 나옴 | 경고 (무관한 ref 는 떼어냄, 마지막 1개는 남김) |
 * | refs_all_irrelevant: 항목의 고유명사가 남은 근거 기사 어디에도 없음 | 치명 (2026-11-02 재검증: 근거가 구글 기사뿐인 '바이두' 항목) |
 * | subject_not_in_refs: 주요 기사 subject 가 근거 기사 어디에도 없음 | 치명 (중국 할당을 채우려 만든 주체) |
 * | han_in_ko: 한국어 본문에 한자 (괄호 병기 포함) | 치명 (2026-11-02 QA: 수리 뒤에도 남은 채 draft 가 됐다) |
 * | length: 글자 수 상한 초과 (여유 없음)     | 치명 (예전 15% 여유 삭제) |
 * | china_centric: 상위 5건 중 중국 주체 ≥ 3 | 치명 (수리 호출 대상. 수리 뒤에도 미달이면 판 전체 failed).
 *   중국 주체 = 근거 기사 subject_region(CN, 대만·홍콩 포함) 다수 + subject_is_chinese 표시 (rules.ts isChinaSubject) |
 * | cluster_topic: 묶음 기사 전부에 공통 주체 | 경고 (주제 묶음은 clusters 에서 뺌) |
 * | term_pinyin_spacing: 병음 띄어쓰기만 다름 | 경고 (DB 표기로 교정) |
 * | headline_length: 헤드라인 32자 초과 (여유 없음) | 치명 (수리 호출 대상, 자동 자르기 없음) |
 * | headline_not_top_story: 헤드라인이 1위 기사 주체를 다루지 않음 | 치명 |
 * | superlative_unsupported / trend_unsupported / qualifier_dropped (rules.ts) | 치명 |
 * | stale_event: 예전 사건을 시점 표시 없이 오늘 일처럼 | 치명 |
 * | money_not_deal / currency_mismatch / amount_not_in_source (rules.ts) | 치명 |
 * | leaked_instruction: 수리 지시문이 본문에 남음 | 치명 |
 * | entity_not_in_original: 중국 기업명이 번역에만 있고 중국어 원문엔 없음 | 치명 |
 * | outlet_count: "두 매체" 인데 근거 매체 수가 적음 | 치명 |
 * | unsupported_entity: headline/lede 의 고유명사가 근거 기사에 없음 | 치명 |
 * | china_attribution: "중국 내" 문장에 해외 실체·지명의 사실 | 치명 |
 * | duplicate_story / shared_ref: 같은 사건을 두 항목에, 같은 기사를 두 주요 기사 근거로 | 치명 (결정적 병합 mergeDuplicateItems) |
 * | time_marker_wrong: 판과 같은 달을 "지난 N월" 로 (rules.ts pastMarkerIssues) | 치명 (결정적 수선: "지난 " 삭제) |
 * | dropped_key_story: 여러 매체가 다룬 사건의 유일한 주요 기사가 검증으로 빠짐 | 경고 (generate.ts, 리뷰어용) |
 *
 * 숫자 검사는 근거에 같은 값으로 나온 금액·큰 수를 표기가 달라도 통과시킨다 (quantity.ts — "162억 8,600만" = "162.86억").
 * 삭제 전 결정적 수선(2026-11-02 재감사 round 2): glossKoHan(한자 사전·괄호 안 한자), fitSentenceLengths(문장·절 자르기),
 * localFixes(문제 문장만 삭제). 고친 기록은 ContentEdit 로 남긴다 (generate.ts validation.edits).
 *
 * refs 관련성 정리를 숫자 검사보다 먼저 한다 — 저장되는 refs 가 곧 검증한 refs 가 되도록.
 */
import type {
  BriefingContent,
  CandidateArticle,
  CandidateGroup,
  EditionMode,
  KeyTerm,
  ValidationIssue,
  ValidationReport,
} from "./types";
import { entityMentioned, findEntities, properNouns } from "./entities";
import { applyHanGlossary, dropHanInsideParens, hanResidue } from "../text/han";
import { HAN_GLOSSARY } from "../text/han-glossary";
import { maskGroundedQuantities } from "./quantity";
import { sameEvent } from "../news-rank";
import {
  claimIssues,
  entityNotInOriginal,
  headlineTopIssue,
  isChinaSubject,
  leakedInstruction,
  moneyIssues,
  outletClaimIssue,
  staleEventIssues,
  type SourceDoc,
} from "./rules";

export interface ValidationContext {
  /** 짧은 id → 근거 텍스트 (title_kr + summary_kr + insight_kr + title_cn, 전재 형제 포함) */
  sourceText: Map<string, string>;
  /** 짧은 id → 제목만 (title_kr + title_cn). 기사의 "주인공" 판정용 (china_attribution). 없으면 sourceText 로 대신한다 */
  titleText?: Map<string, string>;
  keyTerms: Map<string, KeyTerm[]>;
  hidden: Set<string>;
  mode: EditionMode;
  /** 짧은 id → 근거 기사(번역 + 중국어 원문 + 날짜). 의미 규칙(rules.ts)용. 없으면 의미 규칙 일부를 건너뛴다 */
  docs?: Map<string, SourceDoc[]>;
  /** 짧은 id → 매체 이름 (매체 수 주장 검사) */
  outlets?: Map<string, string[]>;
  /** 판 날짜 (주말 합본은 시작일) — 예전 사건 검사 기준 */
  editionDate?: string;
  /** 짧은 id → 사건 키 (같은 사건을 다룬 다른 묶음은 같은 키, news-rank sameEvent). 중복 이야기 검사 (없으면 id 자체) */
  events?: Map<string, string>;
  /** 짧은 id → 같은 사건을 다룬 매체 수 (eventSources ?? sources). 핵심 기사 삭제 경고 (dropped_key_story) */
  eventOutlets?: Map<string, number>;
}

export function toSourceDoc(a: CandidateArticle): SourceDoc {
  return {
    title_kr: a.title_kr ?? "",
    title_cn: a.title_cn ?? "",
    summary_kr: a.summary_kr ?? "",
    summary_cn: a.summary_cn ?? "",
    insight_kr: a.ai_insights_kr ?? "",
    news_date: a.news_date,
    source_name: a.source_name,
    subject_region: a.subject_region ?? null,
  };
}

export function articleText(a: CandidateArticle): string {
  return [a.title_kr, a.summary_kr, a.ai_insights_kr, a.title_cn].filter(Boolean).join(" ");
}

function articleTitle(a: CandidateArticle): string {
  return [a.title_kr, a.title_cn].filter(Boolean).join(" ");
}

export function contextFromGroups(
  groups: CandidateGroup[],
  mode: EditionMode,
  hidden: Set<string> = new Set(),
  editionDate?: string
): ValidationContext {
  const sourceText = new Map<string, string>();
  const titleText = new Map<string, string>();
  const keyTerms = new Map<string, KeyTerm[]>();
  const docs = new Map<string, SourceDoc[]>();
  const outlets = new Map<string, string[]>();
  const eventOutlets = new Map<string, number>();
  for (const g of groups) {
    const members = [g.primary, ...g.siblings];
    sourceText.set(g.shortId, members.map(articleText).join(" "));
    titleText.set(g.shortId, members.map(articleTitle).join(" "));
    keyTerms.set(g.shortId, members.flatMap((a) => a.key_terms ?? []));
    docs.set(g.shortId, members.map(toSourceDoc));
    outlets.set(g.shortId, g.sources);
    eventOutlets.set(g.shortId, (g.eventSources?.length ? g.eventSources : g.sources).length);
  }
  return { sourceText, titleText, keyTerms, hidden, mode, docs, outlets, editionDate, events: groupEvents(groups), eventOutlets };
}

/**
 * 후보 묶음 → 사건 키 (union-find, news-rank sameEvent — 데일리 점수·주간 2단계 묶기와 같은 판정, Gate 2).
 * "Gemini 4 Carbon 발표" 와 "Gemini 4 Carbon 뒤 알파벳 주가" 처럼 제목이 다른 같은 사건 묶음이 같은 키를 받는다.
 */
export function groupEvents(groups: CandidateGroup[]): Map<string, string> {
  const feats = groups.map((g) => {
    const members = [g.primary, ...g.siblings];
    return {
      title_kr: g.primary.title_kr ?? "",
      title_cn: g.primary.title_cn ?? "",
      days: [...new Set(members.map((m) => m.news_date ?? "1970-01-01"))],
      entities: findEntities(members.map((m) => `${m.title_kr ?? ""} ${m.title_cn ?? ""}`).join(" ")).map((e) => e.key),
    };
  });
  const parent = groups.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < groups.length; i++) {
    if (!feats[i].entities.length) continue;
    for (let j = i + 1; j < groups.length; j++) if (feats[j].entities.length && sameEvent(feats[i], feats[j])) parent[find(j)] = find(i);
  }
  return new Map(groups.map((g, i) => [g.shortId, groups[find(i)].shortId]));
}

/**
 * 저장된 판(refs = uuid)을 다시 검증할 때 쓰는 문맥 (관리자 인라인 수정).
 * 기사 한 건 = id 하나 (전재 형제는 저장 단계에서 이미 refs 에 함께 들어가 있다).
 */
export function contextFromArticles(
  articles: CandidateArticle[],
  mode: EditionMode,
  hidden: Set<string> = new Set(),
  editionDate?: string
): ValidationContext {
  const sourceText = new Map<string, string>();
  const titleText = new Map<string, string>();
  const keyTerms = new Map<string, KeyTerm[]>();
  const docs = new Map<string, SourceDoc[]>();
  const outlets = new Map<string, string[]>();
  for (const a of articles) {
    sourceText.set(a.id, articleText(a));
    titleText.set(a.id, articleTitle(a));
    keyTerms.set(a.id, a.key_terms ?? []);
    docs.set(a.id, [toSourceDoc(a)]);
    outlets.set(a.id, [a.source_name]);
  }
  return { sourceText, titleText, keyTerms, hidden, mode, docs, outlets, editionDate };
}

// ───────────────────────── 결정적 정리 (수리 호출 전)

const SENTENCE_END = /(?<=[.!?。])\s+/;

/**
 * 여러 문장 필드(lede·what·why)가 상한을 넘으면 끝 문장부터 통째로 뺀다 (첫 문장은 남긴다, 말줄임표로 자르지 않음).
 * QA 감사 수정안("마지막 문장 삭제")과 같은 처리 — 길이 2자 초과 때문에 중국 주체 주요 기사가 통째로 빠져
 * 판 전체가 중국 중심 미달로 실패하는 것을 막는다. 반환: 고친 판과 손댄 위치
 */
export function fitSentenceLengths(content: BriefingContent): { content: BriefingContent; trimmed: string[]; edits: ContentEdit[] } {
  const c = structuredClone(content);
  const trimmed: string[] = [];
  const edits: ContentEdit[] = [];
  const fit = (path: string, text: string, max: number, clause = false): string => {
    if (text.length <= max) return text;
    const parts = text.split(SENTENCE_END);
    while (parts.length > 1 && parts.join(" ").length > max) parts.pop();
    let out = parts.join(" ");
    // 한 문장짜리 짧은 칸(섹션 한 줄·주목 기업)은 절 경계(쉼표·말줄임·줄표)에서 자른다 — 2026-11-02 재감사 10-27: 76/70자 때문에 항목이 통째로 빠짐
    if (clause && out.length > max) out = trimAtClause(out, max) ?? out;
    if (out !== text) {
      trimmed.push(path);
      edits.push({ action: "trim", path, reason: `length ${text.length}/${max}자`, before: text, after: out });
    }
    return out;
  };
  c.lede = fit("lede", c.lede, 200);
  c.top_stories.forEach((st, i) => {
    st.what = fit(`top_stories[${i}].what`, st.what, 160);
    st.why = fit(`top_stories[${i}].why`, st.why, 120);
  });
  c.sections.forEach((sec, j) => sec.items.forEach((it, k) => (it.text = fit(`sections[${j}].items[${k}]`, it.text, 70, true))));
  c.companies_to_watch.forEach((co, i) => (co.why = fit(`companies_to_watch[${i}].why`, co.why, 40, true)));
  return { content: c, trimmed, edits };
}

/** 절 경계(", " "… " " — " "·")에서 상한 안으로 자른 문장. 남는 길이가 상한의 절반 미만이면 null (뜻이 빠짐) */
export function trimAtClause(text: string, max: number): string | null {
  const cuts = [...text.matchAll(/,\s|…\s?|\s[—–-]\s|·|;\s/g)].map((m) => m.index ?? 0).filter((i) => i > 0 && i <= max);
  if (!cuts.length) return null;
  const out = text.slice(0, Math.max(...cuts)).replace(/[\s,…·;—–-]+$/, "").trim();
  return out.length >= max * 0.5 ? out : null;
}

/** 생성 단계에서 결정적으로 고친 기록 (감사 기록, validation.edits[]) */
export interface ContentEdit {
  action: "trim" | "gloss" | "sentence_delete" | "merge" | "ref_strip" | "repair" | "drop" | "time_marker";
  path: string;
  reason: string;
  before: unknown;
  after: unknown;
  /** 어느 회차의 결과에 한 일인가 (initial / repair / repair2 / final) */
  round?: string;
}

/**
 * 한국어 본문 한자를 결정적으로 고친다 (치명 삭제 전에): 사전(han-glossary)의 4자 이하 이름은 한국어 표기로(괄호 안 포함),
 * 한글이 섞인 괄호 안의 한자는 지운다("캡컷(剪映 국제판)" → "캡컷(국제판)"). 사전에 없는 한자는 그대로 둔다(수리 대상).
 * 주간·월간 glossPeriodicHan 도 같은 applyHanGlossary·dropHanInsideParens 를 쓴다 (Gate 2).
 */
export function glossHanText(t: string): string {
  if (!/[\u3400-\u9fff\uf900-\ufaff]/.test(t)) return t;
  // 라틴 글자가 붙은 이름 (한자 덩어리만으로는 뜻이 정해지지 않아 사전에 넣지 않는다): B站 = 빌리빌리 (09-16 헤드라인)
  const named = t.replace(/B站/g, "빌리빌리");
  return applyHanGlossary(dropHanInsideParens(named), HAN_GLOSSARY, { insideParens: true }).text;
}

export function glossKoHan(content: BriefingContent): { content: BriefingContent; edits: ContentEdit[] } {
  const c = structuredClone(content);
  const edits: ContentEdit[] = [];
  const f = (path: string, t: string) => {
    const out = glossHanText(t);
    if (out !== t) edits.push({ action: "gloss", path, reason: "han_in_ko (사전 치환·괄호 안 한자 삭제)", before: t, after: out });
    return out;
  };
  c.headline = f("headline", c.headline);
  c.lede = f("lede", c.lede);
  c.top_stories.forEach((st, i) => {
    st.title = f(`top_stories[${i}].title`, st.title);
    st.what = f(`top_stories[${i}].what`, st.what);
    st.why = f(`top_stories[${i}].why`, st.why);
    // subject 는 검증 대상 문장이 아니지만 헤드라인 = 1위 기사 판정에 쓰여 같은 표기로 맞춘다 (B站 → 빌리빌리)
    st.subject = glossHanText(st.subject);
  });
  c.sections.forEach((sec, j) => sec.items.forEach((it, k) => (it.text = f(`sections[${j}].items[${k}]`, it.text))));
  c.key_numbers.forEach((k, i) => (k.label = f(`key_numbers[${i}]`, k.label)));
  c.companies_to_watch.forEach((co, i) => (co.why = f(`companies_to_watch[${i}].why`, co.why)));
  return { content: c, edits };
}

const PAREN_HAN_RE = /\s?[(（]\s*[\u3400-\u9fff\uf900-\ufaff·、，,\s]+\s*[)）]/g;

/**
 * 한국어 본문의 괄호 병기 한자를 지운다 ("스텝스타(阶跃星辰)" → "스텝스타"). 괄호 안이 한자뿐일 때만.
 * 생성 직후·수리 직후에 부른다 (번역본에는 부르지 않는다 — zh 는 한자가 본문).
 */
export function stripParentheticalHan(content: BriefingContent): BriefingContent {
  const c = structuredClone(content);
  const f = (t: string) => t.replace(PAREN_HAN_RE, "").replace(/\s{2,}/g, " ").trim();
  c.headline = f(c.headline);
  c.lede = f(c.lede);
  c.top_stories.forEach((st) => {
    st.title = f(st.title);
    st.what = f(st.what);
    st.why = f(st.why);
  });
  c.sections.forEach((sec) => sec.items.forEach((it) => (it.text = f(it.text))));
  c.key_numbers.forEach((k) => (k.label = f(k.label)));
  c.companies_to_watch.forEach((co) => (co.why = f(co.why)));
  return c;
}

// ───────────────────────── 정규화 (LLM 출력 → BriefingContent)

const str = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(str).filter(Boolean) : typeof v === "string" && v ? [v.trim()] : [];
const arr = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? (v.filter((x) => x && typeof x === "object") as Record<string, unknown>[]) : [];

export function normalizeContent(raw: unknown): { content: BriefingContent; issues: ValidationIssue[] } {
  const issues: ValidationIssue[] = [];
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const term = r.term_of_the_day && typeof r.term_of_the_day === "object" ? (r.term_of_the_day as Record<string, unknown>) : null;
  const content: BriefingContent = {
    headline: str(r.headline),
    lede: str(r.lede),
    lede_refs: strArr(r.lede_refs),
    top_stories: arr(r.top_stories).map((s, i) => {
      const refs = strArr(s.refs);
      return {
        rank: i + 1,
        section: str(s.section) || "industry",
        subject: str(s.subject),
        subject_is_chinese: s.subject_is_chinese === true,
        title: str(s.title),
        what: str(s.what),
        why: str(s.why),
        refs,
        primary_ref: str(s.primary_ref) || refs[0] || "",
      };
    }),
    sections: arr(r.sections)
      .map((sec) => ({
        section: str(sec.section) || "industry",
        items: arr(sec.items).map((it) => ({ text: str(it.text), refs: strArr(it.refs) })),
      }))
      .filter((sec) => sec.items.length > 0),
    key_numbers: arr(r.key_numbers).map((k) => ({ value: str(k.value), label: str(k.label), ref: str(k.ref) })),
    companies_to_watch: arr(r.companies_to_watch).map((c) => ({ name: str(c.name), why: str(c.why), refs: strArr(c.refs) })),
    term_of_the_day: term ? { term: str(term.term), pinyin: str(term.pinyin), ref: str(term.ref) } : null,
    clusters: arr(r.clusters).map((c) => ({ story: str(c.story), ids: strArr(c.ids) })),
    excluded: arr(r.excluded).map((e) => ({ id: str(e.id), reason: str(e.reason) })),
  };
  if (!content.headline) issues.push({ level: "fatal", rule: "schema", path: "headline", detail: "headline 없음" });
  if (!content.lede) issues.push({ level: "fatal", rule: "schema", path: "lede", detail: "lede 없음" });
  if (!content.top_stories.length) issues.push({ level: "fatal", rule: "schema", path: "top_stories", detail: "top_stories 없음" });
  content.top_stories.forEach((s, i) => {
    if (!s.title || !s.what) issues.push({ level: "fatal", rule: "schema", path: `top_stories[${i}]`, detail: "title/what 없음" });
  });
  return { content, issues };
}

// ───────────────────────── 검사 단위

interface Unit {
  path: string; // 문장 위치
  item: string; // 항목 위치 (삭제 단위)
  text: string;
  refs: string[];
  /** headline 은 자체 refs 가 없어 본문 전체 refs 로 숫자만 검사한다 (ref 위반은 해당 항목에서 잡힘) */
  numbersOnly?: boolean;
  /** 숫자 대조에 쓸 refs (없으면 refs). 리드는 주요 기사 요약이므로 lede_refs + 주요 기사 refs 로 대조한다 */
  numberRefs?: string[];
  /** 최상급·추세·시점 검사에 쓸 refs (헤드라인 = 1·2위 기사 + lede_refs — 본문 전체로 넓히면 무관한 기사의 "재편" 이 근거가 된다) */
  semanticRefs?: string[];
}

function collectUnits(c: BriefingContent): Unit[] {
  const allRefs = [...new Set(citedRefs(c))];
  // 2026-10-13 v13: 리드가 주요 기사(메타)의 "2점" 을 썼는데 lede_refs 에 그 기사가 없어 판 전체가 failed 가 됐다.
  // 리드의 숫자는 lede_refs 와 주요 기사 refs 안에서 찾는다 (실체 근거 검사는 여전히 lede_refs 기준).
  const ledeNumberRefs = [...new Set([...c.lede_refs, ...c.top_stories.flatMap((s) => s.refs)])];
  const units: Unit[] = [
    {
      path: "headline", item: "headline", text: c.headline, refs: allRefs, numbersOnly: true,
      semanticRefs: [...new Set([...c.lede_refs, ...c.top_stories.slice(0, 2).flatMap((s) => s.refs)])],
    },
    { path: "lede", item: "lede", text: c.lede, refs: c.lede_refs, numberRefs: ledeNumberRefs },
  ];
  c.top_stories.forEach((s, i) => {
    for (const f of ["title", "what", "why"] as const) {
      units.push({ path: `top_stories[${i}].${f}`, item: `top_stories[${i}]`, text: s[f], refs: s.refs });
    }
  });
  c.sections.forEach((sec, j) =>
    sec.items.forEach((it, k) =>
      units.push({ path: `sections[${j}].items[${k}]`, item: `sections[${j}].items[${k}]`, text: it.text, refs: it.refs })
    )
  );
  c.key_numbers.forEach((k, i) =>
    units.push({ path: `key_numbers[${i}]`, item: `key_numbers[${i}]`, text: `${k.value} ${k.label}`, refs: k.ref ? [k.ref] : [] })
  );
  c.companies_to_watch.forEach((co, i) =>
    units.push({ path: `companies_to_watch[${i}]`, item: `companies_to_watch[${i}]`, text: `${co.name} ${co.why}`, refs: co.refs })
  );
  return units;
}

/** 본문에서 인용한 모든 ref (clusters·excluded 제외) */
export function citedRefs(c: BriefingContent): string[] {
  return [
    ...c.lede_refs,
    ...c.top_stories.flatMap((s) => [...s.refs, s.primary_ref].filter(Boolean)),
    ...c.sections.flatMap((s) => s.items.flatMap((i) => i.refs)),
    ...c.key_numbers.map((k) => k.ref).filter(Boolean),
    ...c.companies_to_watch.flatMap((co) => co.refs),
    ...(c.term_of_the_day?.ref ? [c.term_of_the_day.ref] : []),
  ];
}

// ───────────────────────── 숫자

// 한자·한글 정규식의 원본은 src/lib/text/han.ts. 주간·월간 검증기(periodic/validate.ts)가 여기서 가져가므로 다시 내보낸다.
export { HAN_RE, HANGUL_RE } from "../text/han";
/** 문장 속 숫자 (주간·월간 검증기도 같은 정규식을 쓴다) */
export const NUM_RE = /\d[\d,.]*/g;
// 숫자는 숫자로 끝나야 하고("Genie 2, 대화형" 의 "2, 대" 는 아님), 한 글자 단위가 띄어 쓰여 있으면 뒤에 한글이 이어지지 않아야 한다
// ("86 대규모" 는 "86대" 가 아님). 2026-11-02 재생성에서 이 오탐으로 중국 주체 기사가 빠져 판 전체가 실패했다.
const UNIT1 = "위|억|만|명|개|점|회|대|배|년|월|일|종|팀|건|곳|조";
const NUM_UNIT_RE = new RegExp(`\\d(?:[\\d,.]*\\d)?(?:\\s?(?:%|위안|달러|시간|MW|GW|B\\b)|(?:${UNIT1})|\\s(?:${UNIT1})(?![가-힣]))`, "g");
/** 숫자 대조용 정규화: 공백·쉼표 제거 */
export const norm = (s: string) => s.replace(/[\s,]/g, "");

// ───────────────────────── 길이

/** 헤드라인 글자 수 상한 (공백 포함). 15% 여유 없이 엄격하게 본다 — 넘으면 수리 호출 대상 (자동 자르기 없음) */
export const HEADLINE_MAX = 32;

/** 글자 수 상한 (공백 포함). 2026-11-02 부터 여유 없이 치명 — 수리에서 줄이고, 그래도 넘으면 그 항목을 뺀다 */
export const LIMITS: [RegExp, number][] = [
  [/^lede$/, 200],
  [/^top_stories\[\d+\]\.title$/, 40],
  [/^top_stories\[\d+\]\.what$/, 160],
  [/^top_stories\[\d+\]\.why$/, 120],
  [/^sections\[\d+\]\.items\[\d+\]$/, 70],
  [/^companies_to_watch\[\d+\]\.why$/, 40],
];

// ───────────────────────── refs 관련성

/**
 * 항목 텍스트의 고유명사가 하나도 나오지 않는 ref 를 떼어낸다 (마지막 1개는 남기고 경고만).
 * 반환한 content 는 복사본.
 */
export function pruneIrrelevantRefs(
  content: BriefingContent,
  ctx: ValidationContext
): { content: BriefingContent; warn: ValidationIssue[]; fatal: ValidationIssue[]; dropped: { path: string; ref: string }[] } {
  const c: BriefingContent = structuredClone(content);
  const warn: ValidationIssue[] = [];
  const fatal: ValidationIssue[] = [];
  const dropped: { path: string; ref: string }[] = [];

  const check = (path: string, text: string, refs: string[]): string[] => {
    const nouns = properNouns(text);
    if (!nouns.length) return refs;
    const irrelevant = refs.filter((r) => {
      const src = ctx.sourceText.get(r);
      return src !== undefined && !nouns.some((n) => n.matches(src));
    });
    if (!irrelevant.length) return refs;
    let keep = refs.filter((r) => !irrelevant.includes(r));
    if (!keep.length) {
      keep = refs.slice(0, 1);
      // 2026-11-02 재검증: 근거 기사가 모두 무관하면 경고가 아니라 치명 (항목 삭제 대상) — 근거 없는 항목이 중국 할당을 채우지 않게
      fatal.push({ level: "fatal", rule: "refs_all_irrelevant", path, detail: `근거 기사(${refs.join(",")}) 어디에도 ${nouns.map((n) => n.label).join("/")} 가 없음` });
    }
    for (const r of irrelevant.filter((x) => !keep.includes(x))) {
      dropped.push({ path, ref: r });
      warn.push({ level: "warn", rule: "refs_relevance", path, detail: `${r} 에 ${nouns.map((n) => n.label).join("/")} 가 없어 근거에서 뺌` });
    }
    return keep;
  };

  c.lede_refs = check("lede", c.lede, c.lede_refs);
  c.top_stories.forEach((s, i) => {
    s.refs = check(`top_stories[${i}]`, `${s.title} ${s.what} ${s.why}`, s.refs);
    if (!s.refs.includes(s.primary_ref)) s.primary_ref = s.refs[0] ?? "";
  });
  c.sections.forEach((sec, j) =>
    sec.items.forEach((it, k) => {
      it.refs = check(`sections[${j}].items[${k}]`, it.text, it.refs);
    })
  );
  c.companies_to_watch.forEach((co, i) => {
    co.refs = check(`companies_to_watch[${i}]`, `${co.name} ${co.why}`, co.refs);
  });
  c.key_numbers.forEach((k, i) => {
    check(`key_numbers[${i}]`, k.label, k.ref ? [k.ref] : []);
  });
  return { content: c, warn, fatal, dropped };
}

/**
 * 주요 기사의 subject(주체)가 근거 기사 어디에도 나오지 않는가. 고유명사(이름표·라틴 토큰)가 있으면 그것으로,
 * 없으면 한국어 이름 토큰(2자 이상, 조사 제거)이 근거 텍스트에 그대로 있는지 본다. subject 가 비었으면 판단하지 않는다.
 */
export function subjectMissingFromRefs(subject: string, refs: string[], ctx: Pick<ValidationContext, "sourceText">): boolean {
  const subj = (subject ?? "").trim();
  if (!subj) return false;
  const srcs = refs.map((r) => ctx.sourceText.get(r)).filter((x): x is string => x !== undefined);
  if (!srcs.length) return false;
  const nouns = properNouns(subj);
  if (nouns.length) return !nouns.some((n) => srcs.some((t) => n.matches(t)));
  const toks = subj
    .split(/[\s,，·・/]+/)
    .map((t) => t.replace(/[은는이가의]$/, ""))
    .filter((t) => t.length >= 2);
  if (!toks.length) return false;
  const hay = srcs.join(" ").replace(/\s/g, "");
  return !toks.some((t) => hay.includes(t));
}

// ───────────────────────── 근거 없는 실체 (headline·lede)

/**
 * 문장의 고유명사 중 refs 근거 기사 어디에도 나오지 않는 것.
 * (pruneIrrelevantRefs 는 "ref 마다 고유명사 하나라도" 를 보므로, 리드처럼 여러 이야기를 섞는 문장에서
 *  근거 없는 실체가 끼어드는 것은 못 잡는다 → 고유명사 단위로 따로 본다)
 */
export function unsupportedEntities(text: string, refs: string[], ctx: ValidationContext): string[] {
  const srcs = refs.map((r) => ctx.sourceText.get(r)).filter((s): s is string => s !== undefined);
  if (!srcs.length) return [];
  return properNouns(text)
    .filter((n) => !srcs.some((s) => n.matches(s)))
    .map((n) => n.label);
}

// ───────────────────────── "중국 내" 귀속

const CHINA_SCOPE_RE = /중국\s?내|중국\s?안에서|중국에서는|중국\s?국내|国内|中国境内/;
/** 중국 밖 지명: "중국 내에서는 … 일본 데이터센터" 같은 문장은 그 자체로 모순이다 */
const FOREIGN_PLACE_RE = /일본|오사카|도쿄|미국|실리콘밸리|유럽|영국|프랑스|독일|인도|한국|중동|사우디|싱가포르|日本|大阪|东京|美国|欧洲|韩国|印度/;
const CHINA_MENTION_RE = /중국|中国|国内|国产|베이징|상하이|선전|항저우|北京|上海|深圳|杭州/;

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?。！？])\s*/).filter((s) => s.trim());
}

/**
 * 해외 실체의 사실을 "중국 내" 로 묶는 문장 (설계 검토 후속 5c — "중국 내에서는 … Anthropic의 일본 데이터센터").
 * 위반 조건 (문장 단위, "중국 내" 류 표현이 있을 때만):
 *  1) 같은 문장에 중국 밖 지명이 있다, 또는
 *  2) 해외 실체(엔비디아·Anthropic 등)가 있고, 그 실체가 제목에 나오는 근거 기사 중 하나라도 중국을 전혀 언급하지 않는다.
 *     (제목에 나오는 기사가 없으면 본문에 나오는 기사로 본다)
 * "중국 내 엔비디아 점유율 34%" 처럼 근거 기사가 중국 시장을 다루면 통과한다.
 */
export function chinaAttributionIssues(text: string, refs: string[], ctx: ValidationContext): string[] {
  const out: string[] = [];
  for (const s of sentences(text)) {
    if (!CHINA_SCOPE_RE.test(s)) continue;
    const place = s.match(FOREIGN_PLACE_RE);
    if (place) {
      out.push(`"중국 내" 문장에 중국 밖 지명 "${place[0]}"`);
      continue;
    }
    for (const e of findEntities(s).filter((x) => !x.chinese)) {
      const mention = (m: Map<string, string> | undefined) =>
        refs.filter((r) => {
          const t = m?.get(r);
          return t !== undefined && entityMentioned(e, t);
        });
      let about = mention(ctx.titleText);
      if (!about.length) about = mention(ctx.sourceText);
      const offshore = about.filter((r) => !CHINA_MENTION_RE.test(ctx.sourceText.get(r) ?? ""));
      if (offshore.length) out.push(`"중국 내" 문장의 ${e.key} 근거 기사(${offshore.join(",")})는 중국을 다루지 않음`);
    }
  }
  return out;
}

// ───────────────────────── 중국 중심

/** 상위 5건 중 중국 주체 수 (판정은 rules.ts isChinaSubject 하나 — ref 별 근거 기사 묶음의 subject_region 으로 투표) */
export function chinaCentricCount(c: BriefingContent, ctx?: Pick<ValidationContext, "docs">): number {
  return c.top_stories.slice(0, 5).filter((s) => isChinaSubject(s, s.refs.map((r) => ctx?.docs?.get(r) ?? []))).length;
}

export function chinaCentricRequired(mode: EditionMode, topCount: number): number {
  return mode === "normal" ? Math.min(3, topCount) : 0;
}

// ───────────────────────── 본 검증

export function validateKo(
  input: BriefingContent,
  ctx: ValidationContext,
  preIssues: ValidationIssue[] = []
): { content: BriefingContent; report: ValidationReport } {
  const { content, warn: relWarn, fatal: relFatal, dropped } = pruneIrrelevantRefs(input, ctx);
  const fatal: ValidationIssue[] = [...preIssues.filter((i) => i.level === "fatal"), ...relFatal];
  const warn: ValidationIssue[] = [...preIssues.filter((i) => i.level === "warn"), ...relWarn];
  const excludedIds = new Set(content.excluded.map((e) => e.id));
  const units = collectUnits(content);
  let numbersChecked = 0;

  for (const u of units) {
    if (!u.refs.length && !u.numbersOnly) fatal.push({ level: "fatal", rule: "missing_refs", path: u.path, detail: "근거 기사 없음" });
    for (const r of u.numbersOnly ? [] : u.refs) {
      if (!ctx.sourceText.has(r)) fatal.push({ level: "fatal", rule: "unknown_ref", path: u.path, detail: `존재하지 않는 id ${r}` });
      else if (ctx.hidden.has(r) || excludedIds.has(r))
        fatal.push({ level: "fatal", rule: "excluded_or_hidden_ref", path: u.path, detail: `${r} 는 ${ctx.hidden.has(r) ? "숨긴" : "제외한"} 기사` });
    }
    const citedRaw = (u.numberRefs ?? u.refs).map((r) => ctx.sourceText.get(r) ?? "").join(" ");
    const cited = norm(citedRaw);
    // 근거에 같은 값으로 나온 금액·큰 수는 표기가 달라도 통과 ("162억 8,600만 달러" = "162.86억 달러", quantity.ts)
    const numText = maskGroundedQuantities(u.text, citedRaw).text;
    for (const m of numText.match(NUM_RE) ?? []) {
      numbersChecked++;
      const n = norm(m).replace(/[.]+$/, "");
      if (n && !cited.includes(n)) fatal.push({ level: "fatal", rule: "number_not_in_source", path: u.path, detail: `"${m}" 가 근거 기사에 없음` });
    }
    for (const m of numText.match(NUM_UNIT_RE) ?? []) {
      const n = norm(m);
      if (!cited.includes(n)) fatal.push({ level: "fatal", rule: "number_unit_not_in_source", path: u.path, detail: `"${m.trim()}" (숫자+단위) 가 근거 기사에 없음` });
    }
    // 브리핑 본문은 괄호 병기 한자도 한국어 표기로 바꾸게 한다 (수리 프롬프트가 detail 을 그대로 씀).
    // 2026-11-02: 수리 뒤에도 남으면 그 항목을 뺀다 (치명)
    const han = hanResidue(u.text, { allowParenthetical: false });
    if (han.tokens.length) fatal.push({ level: "fatal", rule: "han_in_ko", path: u.path, detail: han.tokens.join("") });
    const lim = LIMITS.find(([re]) => re.test(u.path))?.[1];
    if (lim && u.text.length > lim) fatal.push({ level: "fatal", rule: "length", path: u.path, detail: `${u.text.length}/${lim}자` });
    // "중국 내" 귀속 오류는 모든 문장에서 치명 (헤드라인은 본문 전체 refs 기준)
    for (const d of chinaAttributionIssues(u.text, u.refs, ctx))
      fatal.push({ level: "fatal", rule: "china_attribution", path: u.path, detail: d });
    for (const i of semanticIssues(u, ctx)) fatal.push({ level: "fatal", rule: i.rule, path: u.path, detail: i.detail });
  }
  // 주요 기사의 주체가 근거 기사에 있어야 한다 (중국 할당을 채우려 근거 없는 주체를 만들지 않게)
  content.top_stories.forEach((s, i) => {
    if (subjectMissingFromRefs(s.subject, s.refs, ctx))
      fatal.push({ level: "fatal", rule: "subject_not_in_refs", path: `top_stories[${i}]`, detail: `주체 "${s.subject}" 가 근거 기사(${s.refs.join(",")}) 어디에도 없음` });
  });
  // 회사 why 길이 (단위 텍스트는 name 을 붙여 검사하므로 따로 본다)
  content.companies_to_watch.forEach((co, i) => {
    if (co.why.length > 40) fatal.push({ level: "fatal", rule: "length", path: `companies_to_watch[${i}].why`, detail: `${co.why.length}/40자` });
  });

  // 헤드라인: 엄격한 글자 수 (치명, 수리 호출 대상) + 고유명사가 인용 기사에 있어야 함 + 1위 기사의 사건
  if (content.headline.length > HEADLINE_MAX)
    fatal.push({ level: "fatal", rule: "headline_length", path: "headline", detail: `${content.headline.length}/${HEADLINE_MAX}자` });
  const top = headlineTopIssue(content.headline, content.top_stories[0]);
  if (top) fatal.push({ level: "fatal", rule: top.rule, path: "headline", detail: top.detail });
  const allRefs = [...new Set(citedRefs(content))];
  for (const n of unsupportedEntities(content.headline, allRefs, ctx))
    fatal.push({ level: "fatal", rule: "unsupported_entity", path: "headline", detail: `"${n}" 가 인용 기사 어디에도 없음` });
  // 리드: 고유명사마다 lede_refs 중 하나에는 나와야 함 (여러 이야기를 섞는 문장이라 ref 단위 관련성 검사로는 부족)
  for (const n of unsupportedEntities(content.lede, content.lede_refs, ctx))
    fatal.push({ level: "fatal", rule: "unsupported_entity", path: "lede", detail: `"${n}" 가 lede_refs 근거 기사에 없음` });

  const t = content.term_of_the_day;
  if (t) {
    const terms = ctx.keyTerms.get(t.ref);
    if (!terms) fatal.push({ level: "fatal", rule: "term", path: "term_of_the_day", detail: `ref ${t.ref} 없음` });
    else {
      const hit = terms.find((k) => k.term === t.term);
      const flat = (s: string) => s.normalize("NFC").replace(/\s+/g, "").toLowerCase();
      if (!hit) fatal.push({ level: "fatal", rule: "term", path: "term_of_the_day", detail: `${t.term} 가 ${t.ref} key_terms 에 없음` });
      else if ((hit.pinyin ?? "") !== t.pinyin) {
        if (hit.pinyin && flat(hit.pinyin) === flat(t.pinyin)) {
          // 띄어쓰기만 다르면 DB 표기로 맞춘다 (jù shēn zhì néng → jùshēn zhìnéng)
          warn.push({ level: "warn", rule: "term_pinyin_spacing", path: "term_of_the_day", detail: `${t.pinyin} → ${hit.pinyin}` });
          t.pinyin = hit.pinyin;
        } else fatal.push({ level: "fatal", rule: "term", path: "term_of_the_day", detail: `병음 불일치 (${t.pinyin} ≠ ${hit.pinyin})` });
      }
    }
  }

  // clusters 엄격 정의: 사건 이름의 고유명사 하나가 묶인 기사 모두에 나와야 한다 (주제 묶음 제거)
  content.clusters = content.clusters.filter((cl, i) => {
    const ids = [...new Set(cl.ids)].filter((r) => ctx.sourceText.has(r));
    const nouns = properNouns(cl.story);
    const ok = ids.length >= 2 && nouns.some((n) => ids.every((r) => n.matches(ctx.sourceText.get(r)!)));
    if (!ok)
      warn.push({ level: "warn", rule: "cluster_topic", path: `clusters[${i}]`, detail: `"${cl.story}" — 묶인 기사 전부에 공통 주체가 없어 묶음에서 뺌` });
    else cl.ids = ids;
    return ok;
  });

  // 같은 사건을 두 항목에 쓰지 않는다 / 같은 기사가 두 주요 기사의 근거가 되지 않는다 (2026-11-02 재감사 10-29 Gemini 4 Carbon)
  fatal.push(...duplicateStoryIssues(content, ctx));

  const china = chinaCentricCount(content, ctx);
  const need = chinaCentricRequired(ctx.mode, content.top_stories.length);
  if (china < need)
    fatal.push({ level: "fatal", rule: "china_centric", path: "top_stories", detail: `상위 5건 중 중국 주체 ${china}건 (필요 ${need}건)` });

  const cited = new Set(citedRefs(content));
  return {
    content,
    report: {
      fatal: dedupeIssues(fatal),
      warn: dedupeIssues(warn),
      droppedRefs: dropped,
      stats: {
        numbersChecked,
        topStories: content.top_stories.length,
        chinaCentric: china,
        citedIds: cited.size,
        bodyChars: units.reduce((s, u) => s + u.text.length, 0),
      },
    },
  };
}

/** 단위 하나의 의미 규칙 (rules.ts). 근거 기사(docs)가 없는 문맥이면 건너뛴다 */
function semanticIssues(u: Unit, ctx: ValidationContext): { rule: string; detail: string }[] {
  const leak = leakedInstruction(u.text);
  const out = leak ? [leak] : [];
  if (!ctx.docs) return out;
  const docsOf = (refs: string[]) => refs.flatMap((r) => ctx.docs!.get(r) ?? []);
  const docs = docsOf(u.semanticRefs ?? u.numberRefs ?? u.refs);
  out.push(...claimIssues(u.text, docs));
  out.push(...moneyIssues(u.text, docs, (u.numberRefs ?? u.refs).map((r) => ctx.sourceText.get(r) ?? "").join(" ")));
  if (!/^(key_numbers|companies_to_watch)/.test(u.path) && !/\.why$/.test(u.path))
    out.push(...staleEventIssues(u.text, docs, ctx.editionDate));
  if (!u.numbersOnly) {
    out.push(...entityNotInOriginal(u.text, docsOf(u.refs)));
    const oc = outletClaimIssue(u.text, u.refs.flatMap((r) => ctx.outlets?.get(r) ?? []));
    if (oc) out.push(oc);
  }
  return out;
}

/**
 * 삭제 뒤 최소 개수 (QA 권고 10). normal 판: 주요 기사 4·숫자 3·주목 기업 3.
 * 반환: 부족한 항목 목록 (빈 배열이면 충족).
 */
export const NORMAL_MIN = { top_stories: 4, key_numbers: 3, companies_to_watch: 3 } as const;
export function minCountShortfall(c: BriefingContent, mode: EditionMode): string[] {
  if (mode !== "normal") return [];
  return (Object.keys(NORMAL_MIN) as (keyof typeof NORMAL_MIN)[])
    .filter((k) => c[k].length < NORMAL_MIN[k])
    .map((k) => `${k} ${c[k].length} < ${NORMAL_MIN[k]}`);
}

function dedupeIssues(list: ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>();
  return list.filter((i) => {
    const k = `${i.rule}|${i.path}|${i.detail}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** 문장 위치 → 항목 위치 (top_stories[0].what → top_stories[0]) */
export function itemOf(path: string): string {
  const m = path.match(/^(top_stories\[\d+\]|sections\[\d+\]\.items\[\d+\]|key_numbers\[\d+\]|companies_to_watch\[\d+\]|term_of_the_day|headline|lede|top_stories)/);
  return m ? m[1] : path;
}

/**
 * 수리 뒤에도 남은 치명 위반 항목을 결정적으로 삭제한다.
 * headline/lede 의 치명 위반은 삭제할 수 없으므로 unrecoverable=true.
 */
export function dropFatalItems(
  content: BriefingContent,
  fatal: ValidationIssue[]
): { content: BriefingContent; dropped: string[]; unrecoverable: string[]; edits: ContentEdit[] } {
  const items = new Set(fatal.map((f) => itemOf(f.path)));
  const unrecoverable: string[] = [...items].filter((i) => i === "headline" || i === "lede" || i === "top_stories");
  // 감사 기록: 지우기 전 원문 항목과 사유 (2026-11-02 재감사: 무엇을 지웠는지 알 수 없었다)
  const edits: ContentEdit[] = [...items]
    .filter((i) => !unrecoverable.includes(i))
    .map((i) => ({
      action: "drop" as const,
      path: i,
      reason: fatal.filter((f) => itemOf(f.path) === i).map((f) => `${f.rule}: ${f.detail}`).join(" / "),
      before: itemValue(content, i),
      after: null,
    }));
  const c: BriefingContent = structuredClone(content);
  c.top_stories = c.top_stories.filter((_, i) => !items.has(`top_stories[${i}]`)).map((s, i) => ({ ...s, rank: i + 1 }));
  c.sections = c.sections
    .map((sec, j) => ({ ...sec, items: sec.items.filter((_, k) => !items.has(`sections[${j}].items[${k}]`)) }))
    .filter((sec) => sec.items.length > 0);
  c.key_numbers = c.key_numbers.filter((_, i) => !items.has(`key_numbers[${i}]`));
  c.companies_to_watch = c.companies_to_watch.filter((_, i) => !items.has(`companies_to_watch[${i}]`));
  if (items.has("term_of_the_day")) c.term_of_the_day = null;
  return { content: c, dropped: [...items].filter((i) => !unrecoverable.includes(i)), unrecoverable, edits };
}

/** 항목 위치의 값 (감사 기록용 복사본) */
function itemValue(c: BriefingContent, item: string): unknown {
  let m = item.match(/^top_stories\[(\d+)\]$/);
  if (m) return structuredClone(c.top_stories[Number(m[1])] ?? null);
  m = item.match(/^sections\[(\d+)\]\.items\[(\d+)\]$/);
  if (m) return structuredClone(c.sections[Number(m[1])]?.items[Number(m[2])] ?? null);
  m = item.match(/^key_numbers\[(\d+)\]$/);
  if (m) return structuredClone(c.key_numbers[Number(m[1])] ?? null);
  m = item.match(/^companies_to_watch\[(\d+)\]$/);
  if (m) return structuredClone(c.companies_to_watch[Number(m[1])] ?? null);
  if (item === "term_of_the_day") return structuredClone(c.term_of_the_day);
  return null;
}

// ───────────────────────── 중복 이야기 (같은 사건 = 한 항목)

const eventOf = (ctx: Pick<ValidationContext, "events">, r: string) => ctx.events?.get(r) ?? r;

interface ItemRefs {
  path: string;
  /** 주 근거 (주요 기사 primary_ref, 섹션 첫 ref) */
  main: string;
  refs: string[];
}

function storyItems(c: BriefingContent): { tops: ItemRefs[]; secs: ItemRefs[] } {
  return {
    tops: c.top_stories.map((s, i) => ({ path: `top_stories[${i}]`, main: s.primary_ref || s.refs[0] || "", refs: s.refs })),
    secs: c.sections.flatMap((sec, j) => sec.items.map((it, k) => ({ path: `sections[${j}].items[${k}]`, main: it.refs[0] ?? "", refs: it.refs }))),
  };
}

/**
 * 중복 규칙 (치명 — 결정적 병합 mergeDuplicateItems 의 대상):
 *  - duplicate_story: 같은 사건(주 근거의 사건 키가 같음)을 주요 기사 두 칸에, 또는 주요 기사와 섹션 한 줄에 다시 씀
 *  - shared_ref: 같은 기사가 두 주요 기사의 근거 (한 기사는 주요 기사 하나만 뒷받침)
 * 주목 기업·숫자 칸은 본문 항목을 짚는 칸이라 보지 않는다.
 */
export function duplicateStoryIssues(c: BriefingContent, ctx: Pick<ValidationContext, "events">): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const { tops, secs } = storyItems(c);
  tops.forEach((b, j) => {
    for (const a of tops.slice(0, j)) {
      if (a.main && eventOf(ctx, a.main) === eventOf(ctx, b.main)) {
        out.push({ level: "fatal", rule: "duplicate_story", path: b.path, detail: `${a.path} 와 같은 사건 (${b.main})` });
        return;
      }
      const shared = b.refs.filter((r) => a.refs.includes(r));
      if (shared.length) out.push({ level: "fatal", rule: "shared_ref", path: b.path, detail: `${shared.join(",")} 가 ${a.path} 의 근거이기도 함` });
    }
  });
  secs.forEach((b, j) => {
    if (!b.main) return;
    const top = tops.find((a) => a.refs.some((r) => eventOf(ctx, r) === eventOf(ctx, b.main)));
    const sec = secs.slice(0, j).find((a) => a.main && eventOf(ctx, a.main) === eventOf(ctx, b.main));
    const dup = top ?? sec;
    if (dup) out.push({ level: "fatal", rule: "duplicate_story", path: b.path, detail: `${dup.path} 와 같은 사건 (${b.main})` });
  });
  return out;
}

/**
 * 중복 결정적 정리: 같은 사건이면 아래 항목을 위 항목에 합친다 (근거 refs 를 위 항목으로 옮기고 아래 항목 삭제).
 * 다른 사건이 보조 기사 하나를 함께 인용하면(07-15 처럼 무해한 공유) 아래 항목에서 그 ref 만 뗀다 (남는 ref 가 있을 때).
 */
export function mergeDuplicateItems(content: BriefingContent, ctx: Pick<ValidationContext, "events">): { content: BriefingContent; edits: ContentEdit[] } {
  const c = structuredClone(content);
  const edits: ContentEdit[] = [];
  const mainOf = (s: { primary_ref: string; refs: string[] }) => s.primary_ref || s.refs[0] || "";
  for (let j = 1; j < c.top_stories.length; j++) {
    const b = c.top_stories[j];
    const i = c.top_stories.slice(0, j).findIndex((a) => mainOf(a) && eventOf(ctx, mainOf(a)) === eventOf(ctx, mainOf(b)));
    if (i >= 0) {
      const a = c.top_stories[i];
      edits.push({ action: "merge", path: `top_stories[${j}]`, reason: `duplicate_story → top_stories[${i}] 에 합침`, before: structuredClone(b), after: null });
      a.refs = [...new Set([...a.refs, ...b.refs])];
      c.top_stories.splice(j, 1);
      j--;
      continue;
    }
    for (const a of c.top_stories.slice(0, j)) {
      const shared = b.refs.filter((r) => a.refs.includes(r));
      const left = b.refs.filter((r) => !shared.includes(r));
      if (shared.length && left.length) {
        edits.push({ action: "ref_strip", path: `top_stories[${j}]`, reason: `shared_ref ${shared.join(",")}`, before: [...b.refs], after: left });
        b.refs = left;
        if (!b.refs.includes(b.primary_ref)) b.primary_ref = b.refs[0];
      }
    }
  }
  c.top_stories = c.top_stories.map((s, i) => ({ ...s, rank: i + 1 }));
  // 섹션 한 줄이 주요 기사(또는 앞 섹션 줄)와 같은 사건이면 합친다
  const seen: { refs: string[]; target: { refs: string[] } | null; path: string }[] = c.top_stories.map((s, i) => ({ refs: s.refs, target: s, path: `top_stories[${i}]` }));
  c.sections.forEach((sec, j) => {
    sec.items = sec.items.filter((it, k) => {
      const main = it.refs[0];
      const dup = main ? seen.find((x) => x.refs.some((r) => eventOf(ctx, r) === eventOf(ctx, main))) : undefined;
      if (dup) {
        edits.push({ action: "merge", path: `sections[${j}].items[${k}]`, reason: `duplicate_story → ${dup.path} 에 합침`, before: structuredClone(it), after: null });
        if (dup.target) dup.target.refs = [...new Set([...dup.target.refs, ...it.refs.filter((r) => eventOf(ctx, r) === eventOf(ctx, main))])];
        return false;
      }
      seen.push({ refs: it.refs, target: null, path: `sections[${j}].items[${k}]` });
      return true;
    });
  });
  c.sections = c.sections.filter((sec) => sec.items.length > 0);
  return { content: c, edits };
}

// ───────────────────────── 필드 접근 (부분 수리·감사 기록)

/** 문장 위치(path)의 텍스트. companies_to_watch[i] 는 why */
export function getField(c: BriefingContent, path: string): string | undefined {
  if (path === "headline") return c.headline;
  if (path === "lede") return c.lede;
  let m = path.match(/^top_stories\[(\d+)\]\.(title|what|why)$/);
  if (m) return c.top_stories[Number(m[1])]?.[m[2] as "title" | "what" | "why"];
  m = path.match(/^sections\[(\d+)\]\.items\[(\d+)\]$/);
  if (m) return c.sections[Number(m[1])]?.items[Number(m[2])]?.text;
  m = path.match(/^key_numbers\[(\d+)\]$/);
  if (m) return c.key_numbers[Number(m[1])]?.label;
  m = path.match(/^companies_to_watch\[(\d+)\](?:\.why)?$/);
  if (m) return c.companies_to_watch[Number(m[1])]?.why;
  return undefined;
}

export function setField(c: BriefingContent, path: string, v: string): boolean {
  if (path === "headline") {
    c.headline = v;
    return true;
  }
  if (path === "lede") {
    c.lede = v;
    return true;
  }
  let m = path.match(/^top_stories\[(\d+)\]\.(title|what|why)$/);
  const top = m ? c.top_stories[Number(m[1])] : undefined;
  if (m && top) {
    top[m[2] as "title" | "what" | "why"] = v;
    return true;
  }
  m = path.match(/^sections\[(\d+)\]\.items\[(\d+)\]$/);
  const it = m ? c.sections[Number(m[1])]?.items[Number(m[2])] : undefined;
  if (it) {
    it.text = v;
    return true;
  }
  m = path.match(/^key_numbers\[(\d+)\]$/);
  const kn = m ? c.key_numbers[Number(m[1])] : undefined;
  if (kn) {
    kn.label = v;
    return true;
  }
  m = path.match(/^companies_to_watch\[(\d+)\](?:\.why)?$/);
  const co = m ? c.companies_to_watch[Number(m[1])] : undefined;
  if (co) {
    co.why = v;
    return true;
  }
  return false;
}

// ───────────────────────── 삭제 전 결정적 수선 (문장 하나만 문제면 그 문장만 뺀다)

/** 문제 표현을 짚을 수 있는 규칙: detail 의 첫 "…" 가 문장 속 표현 (han_in_ko 는 한자 덩어리) */
const LOCAL_RULES = new Set([
  "superlative_unsupported",
  "trend_unsupported",
  "qualifier_dropped",
  "number_not_in_source",
  "number_unit_not_in_source",
  "han_in_ko",
  "amount_not_in_source",
  "money_not_deal",
  "currency_mismatch",
]);

function issueToken(f: ValidationIssue): string | null {
  if (f.rule === "han_in_ko") return f.detail.match(/[㐀-鿿豈-﫿]+/)?.[0] ?? null;
  return f.detail.match(/^"([^"]+)"/)?.[1] ?? null;
}

/**
 * 치명 위반이 여러 문장 칸(lede·what·why)의 한 문장에만 있으면 그 문장만 지운다 (항목 통째 삭제 전에).
 * 2026-11-02 재감사 10-30: why 의 '판도' 한 단어 때문에 OpenAI Pro 한도 주요 기사가 통째로 빠졌다.
 * "지난 N월"(판과 같은 달)은 "지난 " 만 지운다. 반환: 고친 판과 기록.
 */
export function localFixes(content: BriefingContent, fatal: ValidationIssue[]): { content: BriefingContent; edits: ContentEdit[] } {
  const c = structuredClone(content);
  const edits: ContentEdit[] = [];
  for (const f of fatal) {
    const text = getField(c, f.path);
    if (text === undefined) continue;
    if (f.rule === "time_marker_wrong") {
      const out = text.replace(/지난\s?(\d{1,2}월)/g, "$1");
      if (out !== text && setField(c, f.path, out)) edits.push({ action: "time_marker", path: f.path, reason: `${f.rule}: ${f.detail}`, before: text, after: out });
      continue;
    }
    if (!LOCAL_RULES.has(f.rule) || !/^(lede|top_stories\[\d+\]\.(what|why))$/.test(f.path)) continue;
    const tok = issueToken(f);
    if (!tok) continue;
    const sents = text.split(SENTENCE_END);
    if (sents.length < 2) continue;
    const keep = sents.filter((x) => !x.includes(tok));
    if (!keep.length || keep.length === sents.length) continue;
    const out = keep.join(" ");
    if (setField(c, f.path, out)) edits.push({ action: "sentence_delete", path: f.path, reason: `${f.rule}: ${f.detail}`, before: text, after: out });
  }
  return { content: c, edits };
}

// ───────────────────────── 핵심 기사 삭제 경고

/**
 * 삭제로 사라진 주요 기사 중 여러 매체가 다룬 사건(같은 사건 매체 ≥ 2)이고, 남은 판 어디에도 그 사건이 없는 것 → dropped_key_story 경고.
 * 리뷰어(사람·AI 검토)가 "핵심 기사가 검증 때문에 빠졌다" 를 알 수 있게 한다.
 */
export function droppedKeyStories(
  before: BriefingContent,
  after: BriefingContent,
  ctx: Pick<ValidationContext, "events" | "eventOutlets">
): ValidationIssue[] {
  const remaining = new Set(citedRefs(after).map((r) => eventOf(ctx, r)));
  const keptMains = new Set(after.top_stories.map((s) => s.primary_ref));
  const out: ValidationIssue[] = [];
  before.top_stories.forEach((s, i) => {
    if (keptMains.has(s.primary_ref)) return;
    const outlets = Math.max(0, ...s.refs.map((r) => ctx.eventOutlets?.get(r) ?? 0));
    if (outlets < 2) return;
    if (s.refs.some((r) => remaining.has(eventOf(ctx, r)))) return;
    out.push({ level: "warn", rule: "dropped_key_story", path: `top_stories[${i}]`, detail: `"${s.title}" (매체 ${outlets}곳) 이 검증으로 빠짐 — 판에 이 사건이 없음` });
  });
  return out;
}
