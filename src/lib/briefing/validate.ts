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
 * | han_in_ko: 한국어 본문에 한자            | 경고 |
 * | length: 15% 초과                        | 경고 |
 * | china_centric: 상위 5건 중 중국 주체 ≥ 3 | 경고 (수리 호출 대상, 항목 삭제·실패 사유 아님) |
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
import { findEntities, isChineseSubject, properNouns } from "./entities";

export interface ValidationContext {
  /** 짧은 id → 근거 텍스트 (title_kr + summary_kr + insight_kr + title_cn, 전재 형제 포함) */
  sourceText: Map<string, string>;
  keyTerms: Map<string, KeyTerm[]>;
  hidden: Set<string>;
  mode: EditionMode;
}

export function articleText(a: CandidateArticle): string {
  return [a.title_kr, a.summary_kr, a.ai_insights_kr, a.title_cn].filter(Boolean).join(" ");
}

export function contextFromGroups(groups: CandidateGroup[], mode: EditionMode, hidden: Set<string> = new Set()): ValidationContext {
  const sourceText = new Map<string, string>();
  const keyTerms = new Map<string, KeyTerm[]>();
  for (const g of groups) {
    sourceText.set(g.shortId, [g.primary, ...g.siblings].map(articleText).join(" "));
    keyTerms.set(g.shortId, [g.primary, ...g.siblings].flatMap((a) => a.key_terms ?? []));
  }
  return { sourceText, keyTerms, hidden, mode };
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
}

function collectUnits(c: BriefingContent): Unit[] {
  const allRefs = [...new Set(citedRefs(c))];
  const units: Unit[] = [
    { path: "headline", item: "headline", text: c.headline, refs: allRefs },
    { path: "lede", item: "lede", text: c.lede, refs: c.lede_refs },
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

export const HAN_RE = /[㐀-鿿豈-﫿]/g;
export const HANGUL_RE = /[가-힯ᄀ-ᇿ㄰-㆏]/;
const NUM_RE = /\d[\d,.]*/g;
const NUM_UNIT_RE = /\d[\d,.]*\s?(?:%|위안|위|억|만|명|개|점|회|대|배|달러|MW|GW|B\b|년|월|일|시간|종|팀|건|곳|조)/g;
const norm = (s: string) => s.replace(/[\s,]/g, "");

// ───────────────────────── 길이

const LIMITS: [RegExp, number][] = [
  [/^headline$/, 32],
  [/^lede$/, 200],
  [/^top_stories\[\d+\]\.title$/, 40],
  [/^top_stories\[\d+\]\.what$/, 160],
  [/^top_stories\[\d+\]\.why$/, 120],
  [/^sections\[\d+\]\.items\[\d+\]$/, 70],
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

// ───────────────────────── 중국 중심

export function chinaCentricCount(c: BriefingContent): number {
  return c.top_stories.slice(0, 5).filter((s) => {
    if (s.subject && isChineseSubject(s.subject)) return true;
    return findEntities(s.title).some((e) => e.chinese);
  }).length;
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
    if (!u.refs.length) fatal.push({ level: "fatal", rule: "missing_refs", path: u.path, detail: "근거 기사 없음" });
    for (const r of u.refs) {
      if (!ctx.sourceText.has(r)) fatal.push({ level: "fatal", rule: "unknown_ref", path: u.path, detail: `존재하지 않는 id ${r}` });
      else if (ctx.hidden.has(r) || excludedIds.has(r))
        fatal.push({ level: "fatal", rule: "excluded_or_hidden_ref", path: u.path, detail: `${r} 는 ${ctx.hidden.has(r) ? "숨긴" : "제외한"} 기사` });
    }
    const cited = norm(u.refs.map((r) => ctx.sourceText.get(r) ?? "").join(" "));
    for (const m of u.text.match(NUM_RE) ?? []) {
      numbersChecked++;
      const n = norm(m).replace(/[.]+$/, "");
      if (n && !cited.includes(n)) fatal.push({ level: "fatal", rule: "number_not_in_source", path: u.path, detail: `"${m}" 가 근거 기사에 없음` });
    }
    for (const m of u.text.match(NUM_UNIT_RE) ?? []) {
      const n = norm(m);
      if (!cited.includes(n)) fatal.push({ level: "fatal", rule: "number_unit_not_in_source", path: u.path, detail: `"${m.trim()}" (숫자+단위) 가 근거 기사에 없음` });
    }
    const han = u.text.match(HAN_RE);
    if (han) warn.push({ level: "warn", rule: "han_in_ko", path: u.path, detail: han.join("") });
    const lim = LIMITS.find(([re]) => re.test(u.path))?.[1];
    if (lim && u.text.length > Math.round(lim * 1.15))
      warn.push({ level: "warn", rule: "length", path: u.path, detail: `${u.text.length}/${lim}자` });
  }

  const t = content.term_of_the_day;
  if (t) {
    const terms = ctx.keyTerms.get(t.ref);
    if (!terms) fatal.push({ level: "fatal", rule: "term", path: "term_of_the_day", detail: `ref ${t.ref} 없음` });
    else {
      const hit = terms.find((k) => k.term === t.term);
      if (!hit) fatal.push({ level: "fatal", rule: "term", path: "term_of_the_day", detail: `${t.term} 가 ${t.ref} key_terms 에 없음` });
      else if ((hit.pinyin ?? "") !== t.pinyin)
        fatal.push({ level: "fatal", rule: "term", path: "term_of_the_day", detail: `병음 불일치 (${t.pinyin} ≠ ${hit.pinyin})` });
    }
  }

  const china = chinaCentricCount(content);
  const need = chinaCentricRequired(ctx.mode, content.top_stories.length);
  if (china < need)
    warn.push({ level: "warn", rule: "china_centric", path: "top_stories", detail: `상위 5건 중 중국 주체 ${china}건 (필요 ${need}건)` });

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
