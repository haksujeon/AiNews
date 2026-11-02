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
 * | han_in_ko: 한국어 본문에 한자 (괄호 병기 포함) | 치명 (2026-11-02 QA: 수리 뒤에도 남은 채 draft 가 됐다) |
 * | length: 글자 수 상한 초과 (여유 없음)     | 치명 (예전 15% 여유 삭제) |
 * | china_centric: 상위 5건 중 중국 주체 ≥ 3 | 치명 (수리 호출 대상. 수리 뒤에도 미달이면 판 전체 failed) |
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
import { hanResidue } from "../text/han";
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
  for (const g of groups) {
    const members = [g.primary, ...g.siblings];
    sourceText.set(g.shortId, members.map(articleText).join(" "));
    titleText.set(g.shortId, members.map(articleTitle).join(" "));
    keyTerms.set(g.shortId, members.flatMap((a) => a.key_terms ?? []));
    docs.set(g.shortId, members.map(toSourceDoc));
    outlets.set(g.shortId, g.sources);
  }
  return { sourceText, titleText, keyTerms, hidden, mode, docs, outlets, editionDate };
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
export function fitSentenceLengths(content: BriefingContent): { content: BriefingContent; trimmed: string[] } {
  const c = structuredClone(content);
  const trimmed: string[] = [];
  const fit = (path: string, text: string, max: number): string => {
    if (text.length <= max) return text;
    const parts = text.split(SENTENCE_END);
    while (parts.length > 1 && parts.join(" ").length > max) parts.pop();
    const out = parts.join(" ");
    if (out !== text) trimmed.push(path);
    return out;
  };
  c.lede = fit("lede", c.lede, 200);
  c.top_stories.forEach((st, i) => {
    st.what = fit(`top_stories[${i}].what`, st.what, 160);
    st.why = fit(`top_stories[${i}].why`, st.why, 120);
  });
  return { content: c, trimmed };
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
const NUM_UNIT_RE = /\d[\d,.]*\s?(?:%|위안|위|억|만|명|개|점|회|대|배|달러|MW|GW|B\b|년|월|일|시간|종|팀|건|곳|조)/g;
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
): { content: BriefingContent; warn: ValidationIssue[]; dropped: { path: string; ref: string }[] } {
  const c: BriefingContent = structuredClone(content);
  const warn: ValidationIssue[] = [];
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
      warn.push({ level: "warn", rule: "refs_relevance", path, detail: `유일한 근거 ${refs[0]} 에 ${nouns.map((n) => n.label).join("/")} 가 없음` });
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
  return { content: c, warn, dropped };
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

/** 상위 5건 중 중국 주체 수 (판정은 rules.ts isChinaSubject 하나 — subject_region 이 들어오면 그 함수만 바꾼다) */
export function chinaCentricCount(c: BriefingContent, ctx?: Pick<ValidationContext, "docs">): number {
  return c.top_stories.slice(0, 5).filter((s) => isChinaSubject(s, s.refs.flatMap((r) => ctx?.docs?.get(r) ?? []))).length;
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
  const { content, warn: relWarn, dropped } = pruneIrrelevantRefs(input, ctx);
  const fatal: ValidationIssue[] = preIssues.filter((i) => i.level === "fatal");
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
    const cited = norm((u.numberRefs ?? u.refs).map((r) => ctx.sourceText.get(r) ?? "").join(" "));
    for (const m of u.text.match(NUM_RE) ?? []) {
      numbersChecked++;
      const n = norm(m).replace(/[.]+$/, "");
      if (n && !cited.includes(n)) fatal.push({ level: "fatal", rule: "number_not_in_source", path: u.path, detail: `"${m}" 가 근거 기사에 없음` });
    }
    for (const m of u.text.match(NUM_UNIT_RE) ?? []) {
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
): { content: BriefingContent; dropped: string[]; unrecoverable: string[] } {
  const items = new Set(fatal.map((f) => itemOf(f.path)));
  const unrecoverable: string[] = [...items].filter((i) => i === "headline" || i === "lede" || i === "top_stories");
  const c: BriefingContent = structuredClone(content);
  c.top_stories = c.top_stories.filter((_, i) => !items.has(`top_stories[${i}]`)).map((s, i) => ({ ...s, rank: i + 1 }));
  c.sections = c.sections
    .map((sec, j) => ({ ...sec, items: sec.items.filter((_, k) => !items.has(`sections[${j}].items[${k}]`)) }))
    .filter((sec) => sec.items.length > 0);
  c.key_numbers = c.key_numbers.filter((_, i) => !items.has(`key_numbers[${i}]`));
  c.companies_to_watch = c.companies_to_watch.filter((_, i) => !items.has(`companies_to_watch[${i}]`));
  if (items.has("term_of_the_day")) c.term_of_the_day = null;
  return { content: c, dropped: [...items].filter((i) => !unrecoverable.includes(i)), unrecoverable };
}
