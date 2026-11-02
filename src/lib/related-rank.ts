/**
 * 관련 기사 v2 점수 — 순수 함수 (DB 없음). 관련 기사 검토(2026-11-02, ~/ainews-reports/related-review/lexical.py)의
 * 어휘 방식을 그대로 옮겼다. 라벨 20건 기준 p@5 strict 0.42 / soft 0.53 (기존 0.02).
 *
 *   점수 = 0.35·Σidf(공유 실체) + 0.45·Σidf(공유 라틴 고유명사) + 0.25·Σidf(공유 key_terms)
 *        + 3.0·cos(title_cn 바이그램×2 + summary_cn 바이그램, tf-idf)          (+0.05 같은 분류)
 *   - 실체: briefing/entities.ts 이름표. ASCII 별칭은 대소문자 무시(검토 스크립트와 같음).
 *   - 고유명사: summary_en 에서 문장 첫머리가 아닌 대문자 낱말, 또는 숫자·안쪽 대문자를 가진 낱말(TorchTPU, M3.1).
 *   - idf = ln((N+1)/(df+1)), N·df 는 후보 창(기준 기사 ±90일) 안의 공개 기사로 센다.
 *
 * 화면은 세 묶음 (rankRelated().sections):
 *   sameEvent "같은 사건 다른 매체" — 기준 기사와 1일 이내 + 강한 겹침(또는 전재). 매체마다 1건, 기준 기사 매체 제외.
 *   flow      "관련 흐름·후속 보도"   — 2일 이상 떨어진 기사. 시간 감쇠 없음(오래된 앞선 보도·후속 보도도 그대로).
 *   company   "같은 기업 소식"        — 위 둘이 아닌, 같은 기업(실체)을 다룬 기사. 정부·대학(cn_gov)은 기업이 아니라 뺀다.
 * 묶음마다 최대 3건, 점수 하한을 넘는 것만 → 빈 묶음이 생길 수 있다(화면에서 숨긴다).
 *
 * ranked 는 검토 스크립트와 같은 "한 줄 목록"(시간 감쇠 0.5+0.5·e^(-Δd/10), 매체당 2건, 하한 1.2) — 라벨 p@5 비교용.
 */
import { ENTITIES } from "./briefing/entities";
import { REPOST_JACCARD } from "./news-rank";

export const W_ENT = 0.35;
export const W_NAME = 0.45;
export const W_KT = 0.25;
export const W_BG = 3.0;
export const CAT_BONUS = 0.05;
export const HALF_LIFE_DAYS = 10;
/** 한 줄 목록(ranked)의 점수 하한 — 검토 스크립트 MIN_SCORE */
export const MIN_SCORE = 1.2;
export const SECTION_LIMIT = 3;
/** 후보 창: 기준 기사 news_date 앞뒤 일수 */
export const RELATED_WINDOW_DAYS = 90;

/** 같은 사건: 1일 이내 + 점수·바이그램 cos 하한. 라벨 쌍(216)에서 1일 이내 raw≥3·cos≥0.1 → 관련 26/26 (tests/news/related-eval.test.ts) */
export const SAME_EVENT_MAX_DAYS = 1;
export const SAME_EVENT_MIN_SCORE = 3;
export const SAME_EVENT_MIN_COS = 0.1;
/** 흐름·후속: 2일 이상 + 같은 하한. 라벨 쌍에서 2일 이상 raw≥3·cos≥0.1 → 관련 0.76 (cos 하한이 없으면 0.43) */
export const FLOW_MIN_DAYS = 2;
export const FLOW_MIN_SCORE = 3;
export const FLOW_MIN_COS = 0.1;
/**
 * 같은 기업: 기업 실체 1개 이상 공유(후보 제목에 그 기업이 나와야 함 — 본문에서 지나가듯 언급한 기사 제외) + 점수 하한 + 30일 이내.
 * 같은 이야기(점수·cos 가 같은 사건/흐름 하한 이상)는 넣지 않는다 — 앞 묶음이 다 차서 밀려난 같은 이야기가 "기업 소식" 으로 다시 나오지 않게.
 */
export const COMPANY_MIN_SCORE = 1.2;
export const COMPANY_MAX_DAYS = 30;
/** "같은 기업 소식" 에 쓰지 않는 실체 (기업이 아님) */
const NON_COMPANY_ENTITIES = new Set(["cn_gov"]);

export type RelatedSection = "sameEvent" | "flow" | "company";
export const RELATED_SECTIONS: RelatedSection[] = ["sameEvent", "flow", "company"];

/** 점수에 필요한 필드. summary_kr 는 앞 220자만 쓴다(검토 스크립트와 같음) */
export interface RelatedDoc {
  id: string;
  source_name: string | null;
  category: string | null;
  title_cn: string | null;
  title_kr: string | null;
  title_en: string | null;
  summary_kr: string | null;
  summary_cn: string | null;
  summary_en: string | null;
  /** key_terms 의 term 목록 (jsonb [{term,...}] 에서 뽑은 것) */
  terms: string[] | null;
  /** YYYY-MM-DD */
  day: string;
}

export interface PairScore {
  /** 시간 감쇠 없는 점수 (묶음에 쓴다) */
  raw: number;
  /** 시간 감쇠를 곱한 점수 (한 줄 목록 ranked) */
  decayed: number;
  ent: number;
  name: number;
  kt: number;
  cos: number;
  /** 날짜 차이(후보 − 기준, 일). 음수 = 앞선 기사 */
  gap: number;
  sharedEntities: string[];
  /** 공유한 기업 실체(cn_gov 제외)가 후보 제목에 나온다 */
  companyInTitle: boolean;
  repost: boolean;
}

export interface ScoredRelated<T extends RelatedDoc> {
  item: T;
  score: PairScore;
}

export interface RelatedRanking<T extends RelatedDoc> {
  sections: Record<RelatedSection, ScoredRelated<T>[]>;
  ranked: ScoredRelated<T>[];
}

// ── 특징 뽑기 ───────────────────────────────────────────────────────────

/** 바이그램은 프로세스 공통 어휘 번호(작은 정수)로 바꿔 둔다 — 문서 빈도를 배열로 셀 수 있어 빠르다 */
export interface Features {
  ent: Set<string>;
  /** 제목에만 나오는 실체 (같은 기업 소식) */
  titleEnt: Set<string>;
  name: Set<string>;
  kt: Set<string>;
  /** 바이그램 어휘 번호·개수 (title_cn ×2 + summary_cn) */
  bgKeys: Int32Array;
  bgCounts: Float64Array;
  /** title_cn 바이그램 집합 (전재 판정) */
  tbg: Set<number>;
  titleCn: string;
  dayNum: number;
}

const featureCache = new WeakMap<RelatedDoc, Features>();

/** Python 의 [\s\W_]+ 제거와 같게: 글자·숫자만 남긴다 */
const NON_WORD = /[^\p{L}\p{N}]+/gu;
/** 코드 포인트 쌍 → 어휘 번호 (VOCAB.get(cp1).get(cp2) — 작은 정수 키라 빠르다) */
const VOCAB = new Map<number, Map<number, number>>();
let vocabSize = 0;
function bigramList(text: string | null | undefined): number[] {
  const t = (text ?? "").replace(NON_WORD, "");
  const out: number[] = [];
  let prev = -1;
  for (let i = 0; i < t.length; i++) {
    let cp = t.charCodeAt(i);
    if (cp >= 0xd800 && cp <= 0xdbff && i + 1 < t.length) cp = t.codePointAt(i++)!; // 확장 한자(서로게이트 쌍)
    if (prev >= 0) {
      let row = VOCAB.get(prev);
      if (!row) VOCAB.set(prev, (row = new Map()));
      let id = row.get(cp);
      if (id === undefined) row.set(cp, (id = vocabSize++));
      out.push(id);
    }
    prev = cp;
  }
  return out;
}

const isAscii = (s: string) => /^[\x00-\x7f]*$/.test(s);
/** ASCII 문자열 별칭은 소문자로 바꾼 본문에서 찾는다(= 대소문자 무시), 그 밖의 문자열은 그대로, 정규식은 정규식으로 */
const ENTITY_MATCHERS = ENTITIES.map((e) => ({
  key: e.key,
  lower: e.aliases.filter((a): a is string => typeof a === "string" && isAscii(a)).map((a) => a.toLowerCase()),
  exact: e.aliases.filter((a): a is string => typeof a === "string" && !isAscii(a)),
  re: e.aliases.filter((a): a is RegExp => typeof a !== "string"),
}));

function entitiesOf(...parts: (string | null | undefined)[]): Set<string> {
  const text = parts.filter(Boolean).join(" ");
  const lower = text.toLowerCase();
  const out = new Set<string>();
  for (const m of ENTITY_MATCHERS) {
    if (m.lower.some((a) => lower.includes(a)) || m.exact.some((a) => text.includes(a)) || m.re.some((r) => r.test(text))) out.add(m.key);
  }
  return out;
}

const NAME_STOP = new Set(
  `The A An And Or Of In On For With To From By At As Is Are Its It New AI China Chinese Says Report
Launches Launch Released Release First Model Models Global Top Over Into After Amid How Why What Who This That
Than More Most Up Not Be Will Can Has Have Billion Million Yuan Dollar Q1 Q2 Q3 Q4 vs Its Big Tech Inc Co
January February March April May June July August September October November December
CEO CTO CFO US U.S UK EU University Technology Technologies Group Intelligence Beijing Shanghai Shenzhen Hangzhou
Hong Kong Pro API Cloud Code Agent Agents Lab Labs Institute Academy Research Science Company Ltd Holdings
RMB HK SAR PRC GDP AI-generated AI-powered AI-native 2025 2026 2027`.split(/\s+/)
);
const TOK = /[A-Za-z][A-Za-z0-9.\-+²]*[A-Za-z0-9²]|[A-Z]/g;
const HAS_DIGIT = /[0-9²]/;
const SENTENCE_END = new Set([".", "!", "?", ":", '"', "“"]);
const isUpper = (c: string) => c >= "A" && c <= "Z";
const innerCap = (t: string) => [...t.slice(1)].some(isUpper);

/** 라틴 고유명사 (소문자로) */
function namesOf(d: RelatedDoc): Set<string> {
  const out = new Set<string>();
  const sen = d.summary_en ?? "";
  for (const m of sen.matchAll(TOK)) {
    const t = m[0];
    // 앞의 공백을 건너뛴 마지막 글자 (Python: sen[:start].rstrip()[-1])
    let j = m.index - 1;
    while (j >= 0 && /\s/.test(sen[j])) j--;
    const sentenceStart = j < 0 || SENTENCE_END.has(sen[j]);
    const inner = HAS_DIGIT.test(t) || innerCap(t);
    if (((isUpper(t[0]) && !sentenceStart) || inner) && !NAME_STOP.has(t) && t.length > 1) out.add(t.toLowerCase());
  }
  for (const m of (d.title_en ?? "").matchAll(TOK)) {
    const t = m[0];
    if ((HAS_DIGIT.test(t) || innerCap(t)) && !NAME_STOP.has(t)) out.add(t.toLowerCase());
  }
  return out;
}

const dayNum = (day: string) => Math.round(Date.parse(`${day}T00:00:00Z`) / 86_400_000);

/** 본문에서 특징을 뽑는다 (기사마다 한 번 — 결과는 문서 객체에 붙여 둔다) */
export function extractFeatures(d: RelatedDoc): Features {
  const tb = bigramList(d.title_cn);
  const bg = new Map<number, number>();
  for (const g of tb) bg.set(g, (bg.get(g) ?? 0) + 2);
  for (const g of bigramList(d.summary_cn)) bg.set(g, (bg.get(g) ?? 0) + 1);
  return {
    ent: entitiesOf(d.title_kr, d.title_en, d.title_cn, d.summary_kr?.slice(0, 220)),
    titleEnt: entitiesOf(d.title_kr, d.title_en, d.title_cn),
    name: namesOf(d),
    kt: new Set((d.terms ?? []).filter((x) => typeof x === "string" && x)),
    bgKeys: Int32Array.from(bg.keys()),
    bgCounts: Float64Array.from(bg.values()),
    tbg: new Set(tb),
    titleCn: (d.title_cn ?? "").trim(),
    dayNum: dayNum(d.day),
  };
}

/** 이미 뽑아 둔 특징을 문서에 붙인다 (related.ts 의 프로세스 캐시가 본문 없이 문서를 만들 때) */
export function attachFeatures(d: RelatedDoc, f: Features): void {
  featureCache.set(d, { ...f, dayNum: dayNum(d.day) });
}

function featuresOf(d: RelatedDoc): Features {
  let f = featureCache.get(d);
  if (!f) {
    f = extractFeatures(d);
    featureCache.set(d, f);
  }
  return f;
}

// ── 말뭉치 통계 (idf) ───────────────────────────────────────────────────

export interface CorpusStats {
  n: number;
  ent: Map<string, number>;
  name: Map<string, number>;
  kt: Map<string, number>;
  /** 바이그램 idf, 어휘 번호로 찾는다 (corpusStats 가 한 번 계산. 말뭉치에 없는 바이그램 = ln(N+1)) */
  bgIdf: Float64Array;
}

function bump<K>(m: Map<K, number>, keys: Iterable<K>) {
  for (const k of keys) m.set(k, (m.get(k) ?? 0) + 1);
}

/** 문서 빈도. 같은 id 는 한 번만 센다 */
export function corpusStats(docs: RelatedDoc[]): CorpusStats {
  const st: CorpusStats = { n: 0, ent: new Map(), name: new Map(), kt: new Map(), bgIdf: new Float64Array(0) };
  const seen = new Set<string>();
  const feats: Features[] = [];
  for (const d of docs) {
    if (seen.has(d.id)) continue;
    seen.add(d.id);
    const f = featuresOf(d);
    feats.push(f);
    st.n++;
    bump(st.ent, f.ent);
    bump(st.name, f.name);
    bump(st.kt, f.kt);
  }
  const df = new Int32Array(vocabSize);
  for (const f of feats) for (let i = 0; i < f.bgKeys.length; i++) df[f.bgKeys[i]]++;
  st.bgIdf = new Float64Array(vocabSize);
  for (let g = 0; g < df.length; g++) st.bgIdf[g] = Math.log((st.n + 1) / (df[g] + 1));
  return st;
}

const idf = (st: CorpusStats, m: Map<string, number>, k: string) => Math.log((st.n + 1) / ((m.get(k) ?? 0) + 1));

const bgIdfOf = (st: CorpusStats, g: number) => (g < st.bgIdf.length ? st.bgIdf[g] : Math.log(st.n + 1));

function norm(f: Features, st: CorpusStats): number {
  let s = 0;
  for (let i = 0; i < f.bgKeys.length; i++) {
    const w = f.bgCounts[i] * bgIdfOf(st, f.bgKeys[i]);
    s += w * w;
  }
  return Math.sqrt(s) || 1;
}

function jaccardSet<K>(a: Set<K>, b: Set<K>): number {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

function isRepostF(a: Features, b: Features): boolean {
  if (a.titleCn && a.titleCn === b.titleCn) return true;
  return jaccardSet(a.tbg, b.tbg) >= REPOST_JACCARD;
}

/** 같은 글(전재) 판정 — news-rank dedupeReposts 와 같은 규칙(title_cn 같음 또는 바이그램 Jaccard ≥ 0.6) */
export function isRepost(a: RelatedDoc, b: RelatedDoc): boolean {
  return isRepostF(featuresOf(a), featuresOf(b));
}

const sumIdf = (st: CorpusStats, m: Map<string, number>, a: Set<string>, b: Set<string>) => {
  let s = 0;
  for (const k of a) if (b.has(k)) s += idf(st, m, k);
  return s;
};

/** seedVec[어휘 번호] = 기준 기사 바이그램 개수·idf² (후보마다 다시 만들지 않는다) */
function scorePair(seed: RelatedDoc, fs: Features, ns: number, seedVec: Float64Array, c: RelatedDoc, fc: Features, nc: number, st: CorpusStats): PairScore {
  const ent = sumIdf(st, st.ent, fs.ent, fc.ent);
  const name = sumIdf(st, st.name, fs.name, fc.name);
  const kt = sumIdf(st, st.kt, fs.kt, fc.kt);
  let dot = 0;
  for (let i = 0; i < fc.bgKeys.length; i++) {
    const g = fc.bgKeys[i];
    if (g < seedVec.length) dot += seedVec[g] * fc.bgCounts[i];
  }
  const cos = dot / (ns * nc);
  const gap = fc.dayNum - fs.dayNum;
  const shared = [...fs.ent].filter((k) => fc.ent.has(k)).sort();
  const base = W_ENT * ent + W_NAME * name + W_KT * kt + W_BG * cos;
  const cat = seed.category === c.category ? CAT_BONUS : 0;
  const tf = 0.5 + 0.5 * Math.exp(-Math.abs(gap) / HALF_LIFE_DAYS);
  return {
    raw: base + cat,
    decayed: tf * base + cat,
    ent,
    name,
    kt,
    cos,
    gap,
    sharedEntities: shared,
    companyInTitle: shared.some((k) => !NON_COMPANY_ENTITIES.has(k) && fc.titleEnt.has(k)),
    repost: isRepostF(fs, fc),
  };
}

export interface RankOptions {
  /** idf 말뭉치. 없으면 [seed, ...candidates] 로 센다 */
  stats?: CorpusStats;
  /** 한 줄 목록 길이 (기본 5) */
  k?: number;
}

const byScore =
  (key: "raw" | "decayed") =>
  <T extends RelatedDoc>(a: ScoredRelated<T>, b: ScoredRelated<T>) =>
    b.score[key] - a.score[key] || (a.item.id < b.item.id ? -1 : a.item.id > b.item.id ? 1 : 0);

/** 후보 전부의 점수 (기준 기사·같은 id 는 한 번만, 기준 기사 자신은 뺀다) */
export function scoreCandidates<T extends RelatedDoc>(seed: T, candidates: T[], stats?: CorpusStats): ScoredRelated<T>[] {
  const st = stats ?? corpusStats([seed, ...candidates]);
  const fs = featuresOf(seed);
  const ns = norm(fs, st);
  const seedVec = new Float64Array(vocabSize);
  for (let i = 0; i < fs.bgKeys.length; i++) {
    const idfG = bgIdfOf(st, fs.bgKeys[i]);
    seedVec[fs.bgKeys[i]] = fs.bgCounts[i] * idfG * idfG;
  }
  const all: ScoredRelated<T>[] = [];
  const seen = new Set<string>([seed.id]);
  for (const c of candidates) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    const fc = featuresOf(c);
    all.push({ item: c, score: scorePair(seed, fs, ns, seedVec, c, fc, norm(fc, st), st) });
  }
  return all;
}

/**
 * 관련 기사 순위 (상세 페이지·모달·미리 계산이 모두 이 함수를 쓴다 — Gate 2). 결정적: 같은 입력이면 같은 결과.
 */
export function rankRelated<T extends RelatedDoc>(seed: T, candidates: T[], opts: RankOptions = {}): RelatedRanking<T> {
  const k = opts.k ?? 5;
  const all = scoreCandidates(seed, candidates, opts.stats);


  // 한 줄 목록 (검토 스크립트 related()): 전재 제외, 감쇠 점수, 하한, 같은 글 하나만, 매체당 2건
  const ranked: ScoredRelated<T>[] = [];
  const perSrc = new Map<string, number>();
  for (const r of all.filter((r) => !r.score.repost).sort(byScore("decayed"))) {
    if (r.score.decayed < MIN_SCORE || ranked.length >= k) break;
    if (ranked.some((o) => isRepost(o.item, r.item))) continue;
    const src = r.item.source_name ?? "";
    if ((perSrc.get(src) ?? 0) >= 2) continue;
    perSrc.set(src, (perSrc.get(src) ?? 0) + 1);
    ranked.push(r);
  }

  // 묶음: 감쇠 없는 점수(raw) 순으로 고른다
  const byRaw = [...all].sort(byScore("raw"));
  const picked: ScoredRelated<T>[] = [];
  const dupOfPicked = (r: ScoredRelated<T>) => picked.some((o) => isRepost(o.item, r.item));

  // 1) 같은 사건 다른 매체 — 전재가 먼저, 다음 강한 겹침. 매체마다 1건, 기준 기사의 매체는 제외
  const sameEvent: ScoredRelated<T>[] = [];
  const outlets = new Set<string>([seed.source_name ?? ""]);
  const eventOrder = [...byRaw.filter((r) => r.score.repost), ...byRaw.filter((r) => !r.score.repost)];
  for (const r of eventOrder) {
    if (sameEvent.length >= SECTION_LIMIT) break;
    const s = r.score;
    if (Math.abs(s.gap) > SAME_EVENT_MAX_DAYS) continue;
    if (!s.repost && (s.raw < SAME_EVENT_MIN_SCORE || s.cos < SAME_EVENT_MIN_COS)) continue;
    const src = r.item.source_name ?? "";
    if (outlets.has(src)) continue;
    outlets.add(src);
    sameEvent.push(r);
  }
  sameEvent.sort(byScore("raw")); // 고를 때만 전재가 먼저, 보일 때는 점수순 (표에서 읽을 때와 같은 순서)
  picked.push(...sameEvent);

  // 2) 관련 흐름·후속 — 2일 이상 떨어진 기사, 점수순으로 고르고 최신순으로 보인다
  const flow: ScoredRelated<T>[] = [];
  for (const r of byRaw) {
    if (flow.length >= SECTION_LIMIT) break;
    const s = r.score;
    if (s.repost || Math.abs(s.gap) < FLOW_MIN_DAYS || s.raw < FLOW_MIN_SCORE || s.cos < FLOW_MIN_COS) continue;
    if (dupOfPicked(r) || flow.some((o) => isRepost(o.item, r.item))) continue;
    flow.push(r);
  }
  flow.sort((a, b) => b.score.gap - a.score.gap || byScore("raw")(a, b));
  picked.push(...flow);

  // 3) 같은 기업 소식 — 기업 실체 공유(후보 제목에), 같은 이야기 아님, 위 묶음에 없는 기사
  const company: ScoredRelated<T>[] = [];
  for (const r of byRaw) {
    if (company.length >= SECTION_LIMIT) break;
    const s = r.score;
    if (s.repost || s.raw < COMPANY_MIN_SCORE || Math.abs(s.gap) > COMPANY_MAX_DAYS) continue;
    if (s.raw >= FLOW_MIN_SCORE && s.cos >= FLOW_MIN_COS) continue; // 같은 이야기 — 앞 묶음 몫
    if (!s.companyInTitle) continue;
    if (picked.some((o) => o.item.id === r.item.id) || dupOfPicked(r)) continue;
    company.push(r);
    picked.push(r);
  }

  return { sections: { sameEvent, flow, company }, ranked };
}
