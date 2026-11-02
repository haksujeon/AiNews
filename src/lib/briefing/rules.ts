/**
 * 브리핑 의미 규칙 — 데일리(validate.ts)와 주간·월간(periodic/validate.ts)이 같은 함수를 쓴다 (Gate 2).
 * 편집 QA 감사(2026-11-02, 주장 454건 중 오류 53건)에서 나온 패턴을 결정적으로 잡는다.
 *
 *  - isChinaSubject: 중국 중심 규칙의 "중국 주체" 판정 (하나의 함수 — subject_region 이 들어오면 여기만 바꾼다)
 *  - claimIssues: 최상급·서열("최고/최대/첫/유일/역대/1위/가장")과 추세 단정("주도/재편/이동/가열/주류")이
 *      인용 기사에 있는지, 원문이 '중'·'전망'·'가능성' 같은 수식어로 한정했는데 브리핑이 그 수식어를 뺐는지
 *  - staleEventIssues: 근거 기사가 날짜로 못 박은 예전 사건(편집일보다 STALE_DAYS 넘게 전)을 시점 표시 없이 오늘 일처럼
 *  - moneyIssues: 매출·기업가치를 거래 금액처럼(확보·유치·조달), 원문(중국어)과 다른 통화(110亿元 → 110억 달러)
 *  - leakedInstruction: 수리 지시문이 본문에 새어 나옴 ("표기 대신 '스텝스타'")
 *  - headlineTopIssue: 헤드라인이 1위 기사의 주체를 다루지 않음
 *  - entityNotInOriginal: 중국 기업 이름이 한국어 번역에만 있고 중국어 원문에는 없음 (원천 오역 전파: 荣耀 → 화웨이)
 *  - outletClaimIssue: "두 매체가 전했다" 인데 근거 기사의 매체 수가 그보다 적음
 *
 * 이 파일은 DB 를 import 하지 않는다 (단위 테스트).
 */
import { LATIN_STOP, entityMentioned, findEntities, isChineseSubject, properNouns, type Entity } from "./entities";

/** 근거 기사 한 건 (한국어 번역 + 중국어 원문). 데일리 후보·주간 이야기 묶음이 같은 모양으로 넘긴다 */
export interface SourceDoc {
  title_kr: string;
  title_cn: string;
  summary_kr: string;
  summary_cn?: string;
  insight_kr?: string;
  /** YYYY-MM-DD (베이징 날짜) */
  news_date?: string;
  source_name?: string;
  /** 기사 주체 지역 (분류기 v2, 아직 판정에 쓰지 않음 — isChinaSubject 참고) */
  subject_region?: string | null;
}

export interface RuleIssue {
  rule: string;
  detail: string;
}

// ───────────────────────── 문장

// 마침표는 뒤에 공백이 올 때만 문장 끝 ("2.7%" 를 자르지 않게). 중국어 문장부호는 공백 없이도 끝
const SENT_SPLIT = /(?<=[.!?…])\s+|(?<=[。！？])\s*|\n+/;
export function splitSentences(text: string): string[] {
  return (text ?? "").split(SENT_SPLIT).map((s) => s.trim()).filter(Boolean);
}

const flat = (s: string) => s.replace(/[\s,]/g, "");
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** 숫자 경계를 지켜 포함 여부 ("2억" 이 "162억" 에 걸리지 않게) */
function hasNumberToken(hay: string, needle: string): boolean {
  return new RegExp(`(?<![\\d.])${escapeRe(needle)}`).test(hay);
}

// ───────────────────────── 중국 주체 (중국 중심 규칙)

export interface ChinaStory {
  subject?: string;
  title?: string;
  text?: string;
  subject_is_chinese?: boolean;
}

/**
 * 이야기의 주체가 중국 기업·기관인가. 데일리 top_stories 와 주간·월간 big_picture 가 같은 함수를 쓴다.
 *  1) subject·제목에 중국 실체(이름표)나 중국 지명이 있으면 중국 주체
 *  2) 이름표에 없는 중국 기업(쉰처·Diffusion Intelligence 등)은 LLM 표시(subject_is_chinese)를 믿되,
 *     subject 가 해외 실체로만 이루어졌으면(OpenAI 를 중국으로 표시) 믿지 않는다
 *  3) 주간·월간 흐름(text)은 본문에 중국 실체·지명이 있으면 중국 주체
 * articles: 근거 기사 — 기사 주체 지역(subject_region)이 운영에 들어오면 이 함수 안에서만 바꾼다
 *   (예: articles 의 과반이 subject_region === "CN" 이면 중국 주체). 지금은 쓰지 않는다.
 */
export function isChinaSubject(story: ChinaStory, articles: SourceDoc[] = []): boolean {
  void articles;
  if (story.subject && isChineseSubject(story.subject)) return true;
  if (story.title && findEntities(story.title).some((e) => e.chinese)) return true;
  if (story.text && isChineseSubject(story.text)) return true;
  if (story.subject_is_chinese) {
    const es = findEntities(story.subject ?? "");
    return !(es.length && es.every((e) => !e.chinese));
  }
  return false;
}

// ───────────────────────── 최상급·추세 단정

interface ClaimWord {
  key: string;
  /** 브리핑 문장에서 찾는 표현 */
  brief: RegExp;
  /** 근거 기사(한국어·중국어)에서 같은 뜻 */
  src: RegExp;
  kind: "superlative" | "trend";
}

export const CLAIM_WORDS: ClaimWord[] = [
  // "최고경영자·최고기술책임자" 같은 직함은 뺀다
  { key: "최고", kind: "superlative", brief: /최고(?!\s?(?:경영|기술|재무|운영|위|책임|전략|과학|제품|투자|정보|마케팅|인사|법무|사업|개발))/, src: /최고|最高|最佳|最强|最好|最优|最先进/ },
  // "최대 110억 달러"(상한, up to)는 서열이 아니다 → 숫자 앞 최대는 뺀다
  { key: "최대", kind: "superlative", brief: /최대(?!\s?(?:약\s?)?\d|한)/, src: /최대|最大|最多|最高|最大规模/ },
  { key: "최초", kind: "superlative", brief: /최초|처음으로|(?<![가-힣])첫(?=\s|번째|[가-힣])/, src: /최초|처음|(?<![가-힣])첫|首次|首个|首款|首家|首度|首|第一/ },
  { key: "유일", kind: "superlative", brief: /유일/, src: /유일|唯一|独家/ },
  { key: "역대", kind: "superlative", brief: /역대|사상\s?최|사상\s?첫/, src: /역대|사상|史上|历史|有史以来|创纪录|纪录/ },
  { key: "1위", kind: "superlative", brief: /(?<![\d.])1위|1등|선두/, src: /(?<![\d.])1위|1등|선두|第一|首位|榜首|登顶|领跑|居首|冠军/ },
  { key: "가장", kind: "superlative", brief: /가장\s?(?:많|큰|크|높|빠|강|낮|적|작|앞|뛰어|활발|비싼|싼)/, src: /가장|最/ },
  { key: "주도", kind: "trend", brief: /주도(?!권)|이끌|이끈/, src: /주도|이끌|이끈|主导|引领|带头|领跑|领衔/ },
  { key: "주류", kind: "trend", brief: /주류/, src: /주류|主流/ },
  { key: "재편", kind: "trend", brief: /재편|판도/, src: /재편|판도|重塑|洗牌|重构|格局/ },
  { key: "가열", kind: "trend", brief: /가열|(?<!본)격화|과열/, src: /가열|격화|과열|치열|过热|升温|白热化|激烈/ },
  { key: "이동", kind: "trend", brief: /무게\s?(?:중심)?(?:이|가|를)?\s?(?:이동|옮)|옮겨가|옮겨 가|중심이 이동|초점이 (?:옮|이동)/, src: /옮겨|이동|转向|转移/ },
];

/** 원문이 이 표현을 한정할 때 쓰는 말 (전망·가능성·계획·"중 하나" 등) */
const SRC_HEDGE_RE = /전망|예상|예고|예정|계획|추진|목표|가능성|가능할|시사|관측|기대|도전|노린|노려|것으로 알려|것으로 보|으로 보인|추정|검토|중 하나|있을 수|될 수|有望|可能|预计|计划|拟|或将|之一|预期|目标|冲刺|有机会/;
/** 브리핑 문장이 한정을 유지했다고 볼 표현 */
const BRIEF_HEDGE_RE = /전망|예상|예고|예정|계획|추진|목표|가능성|가능|시사|관측|기대|도전|중 하나|것으로|라고|밝혔|주장|평가|보도|알려|추정|검토|노린|노려|준비|내세|소개|자평|자사/;

function docSentences(d: SourceDoc): { body: string[]; titleKo: string[]; zh: string[] } {
  return {
    body: [...splitSentences(d.summary_kr), ...splitSentences(d.insight_kr ?? "")],
    titleKo: d.title_kr ? [d.title_kr] : [],
    zh: [...(d.title_cn ? [d.title_cn] : []), ...splitSentences(d.summary_cn ?? "")],
  };
}

/** 표현 바로 앞이 "중"(X 중 최고·模型中最) — 범위 한정 */
function qualifiedBefore(sentence: string, idx: number): boolean {
  const before = sentence.slice(Math.max(0, idx - 6), idx);
  return /(?<![가-힣])중(?:에서|에)?\s?$/.test(before) || /中$|之中$/.test(before);
}

/** 범위를 정하는 플랫폼·데이터 이름 ("OpenRouter 데이터에 따르면", "MPDocBench에서") */
const SCOPE_RE = /([A-Z][A-Za-z0-9.\-]{2,})\s?(?:의\s?)?(?=데이터|플랫폼|기준|순위|차트|리더보드|벤치마크|에서|에 따르면|数据|平台|榜单|上)/g;
export function scopeTokens(sentence: string): string[] {
  // GPU·API 같은 일반 약어는 범위가 아니다 ("일반 GPU에서 구동")
  return [...sentence.matchAll(SCOPE_RE)].map((m) => m[1]).filter((t) => !LATIN_STOP.has(t) && !LATIN_STOP.has(t.replace(/s$/, "")));
}

function occurrenceHedged(sentence: string, re: RegExp): { hedged: boolean; qualified: boolean; scope: string[] } {
  const m = re.exec(sentence);
  const idx = m?.index ?? 0;
  // 한정 표현은 그 표현 앞뒤 40자 안에서만 본다 (같은 문장 다른 사실의 "전망" 에 끌려가지 않게)
  const near = sentence.slice(Math.max(0, idx - 40), idx + 40);
  return { hedged: SRC_HEDGE_RE.test(near), qualified: qualifiedBefore(sentence, idx) || /之一/.test(near), scope: scopeTokens(sentence) };
}

/**
 * 최상급·추세 단정 검사. 근거 문장 우선순위: 한국어 요약·인사이트 → 한국어 제목 → 중국어 제목·요약
 * (제목은 "史上最大IPO" 처럼 한정 없이 쓰는 경우가 많아, 본문에 같은 표현이 있으면 본문 기준으로 본다).
 *  - superlative_unsupported / trend_unsupported: 그 표현(또는 중국어 같은 뜻)이 근거 기사에 없음
 *  - qualifier_dropped: 근거 문장이 모두 "중"·"전망"·"가능성" 등으로 한정했는데 브리핑 문장은 한정 없이 단정
 */
export function claimIssues(text: string, docs: SourceDoc[], opts: { skip?: RegExp } = {}): RuleIssue[] {
  const out: RuleIssue[] = [];
  if (!docs.length) return out;
  const sents = docs.map(docSentences);
  for (const s of splitSentences(text)) {
    const sentence = opts.skip ? s.replace(opts.skip, " ") : s;
    const nouns = properNouns(sentence);
    for (const w of CLAIM_WORDS) {
      const bm = w.brief.exec(sentence);
      if (!bm) continue;
      // 근거 문장: 본문 → 한국어 제목 → 중국어 순. 브리핑 문장과 고유명사를 공유하는 문장을 먼저 고른다
      const tiers = (["body", "titleKo", "zh"] as const).map((k) => sents.flatMap((x) => x[k]).filter((x) => w.src.test(x)));
      // 고유명사를 가장 많이 공유하는 문장만 (같은 기사 묶음의 다른 사실 문장에 끌려가지 않게)
      const related = tiers.map((t) => {
        const scored = t.map((x) => ({ x, k: nouns.filter((n) => n.matches(x)).length })).filter((y) => y.k > 0);
        const best = Math.max(0, ...scored.map((y) => y.k));
        return scored.filter((y) => y.k === best).map((y) => y.x);
      });
      const occ = related.find((t) => t.length) ?? tiers.find((t) => t.length) ?? [];
      if (!occ.length) {
        out.push({ rule: w.kind === "trend" ? "trend_unsupported" : "superlative_unsupported", detail: `"${bm[0]}" — 근거 기사에 같은 표현이 없음` });
        continue;
      }
      const states = occ.map((o) => occurrenceHedged(o, w.src));
      // 브리핑은 "27B 경량 모델 중 오픈소스 최고" 처럼 한정어가 몇 낱말 앞에 와도 한정을 지킨 것으로 본다
      const briefQualified = /(?<![가-힣])중(?:에서)?\s/.test(sentence.slice(Math.max(0, bm.index - 16), bm.index)) || /중 하나/.test(sentence);
      if (states.every((x) => x.qualified) && !briefQualified) {
        out.push({ rule: "qualifier_dropped", detail: `"${bm[0]}" — 원문은 범위를 한정함("…중 ${bm[0]}"): ${occ[0].slice(0, 60)}` });
        continue;
      }
      // 범위 한정("중")만 있고 전망류가 없는 근거는 위 규칙이 본다 — 여기서는 전망·가능성을 지웠는지
      if (states.every((x) => x.hedged || (x.qualified && !briefQualified)) && states.some((x) => x.hedged) && !BRIEF_HEDGE_RE.test(sentence)) {
        out.push({ rule: "qualifier_dropped", detail: `"${bm[0]}" — 원문은 전망·가능성으로 씀: ${occ[0].slice(0, 60)}` });
        continue;
      }
      // 플랫폼·데이터 범위 ("OpenRouter 에서 처음으로") — 근거 문장이 모두 범위를 달았는데 브리핑은 범위를 뺌
      if (w.kind === "superlative" && states.every((x) => x.scope.length) && !states.some((x) => x.scope.some((t) => sentence.includes(t))))
        out.push({ rule: "qualifier_dropped", detail: `"${bm[0]}" — 원문은 ${states[0].scope[0]} 범위의 수치: 범위를 밝히십시오` });
    }
  }
  return out;
}

// ───────────────────────── 예전 사건을 오늘 일처럼

export const STALE_DAYS = 7;
const EVENT_VERB_RE = /공개(?!적)|발표|출시|선보|제출|설립|인수|상장|내놓|발간|开源|发布|推出|公布|上市|收购/g;
/** 브리핑 문장의 시점 표시 (있으면 예전 사건을 배경으로 쓴 것으로 본다) */
const BRIEF_TIME_RE = /\d{1,2}월|\d{4}년|지난|앞서|이전|당시|후속|작년|지난해|전년|\d+\s?(?:주|개월|달|일)\s?(?:전|만|뒤|후)|이미|그동안/;
const KO_FULL_DATE = /(\d{4})년\s?(\d{1,2})월(?:\s?(\d{1,2})일)?/g;
const KO_MD = /(?<!\d)(\d{1,2})월\s?(\d{1,2})일/g;
const ZH_FULL_DATE = /(\d{4})年(\d{1,2})月(?:(\d{1,2})日)?/g;
const ZH_MD = /(?<![\d年])(\d{1,2})月(\d{1,2})日/g;
const REL_AGO = /(\d+)\s?(주|개월|달|년|周|个月|年)\s?(?:만에|뒤|후|전|前|后)/;

const dayNum = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");

/** 문장 속 날짜 중 편집일보다 STALE_DAYS 넘게 이전인 것 (없으면 null) */
export function staleDateIn(sentence: string, editionDate: string): string | null {
  const ed = dayNum(editionDate);
  const year = Number(editionDate.slice(0, 4));
  const cands: string[] = [];
  for (const re of [KO_FULL_DATE, ZH_FULL_DATE]) {
    for (const m of sentence.matchAll(re)) {
      // 달만 있으면 그 달 말일로 본다 ("2026년 9월" 은 9월 16일 판에 예전 사건이 아님)
      const day = m[3] ? Number(m[3]) : new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
      cands.push(`${m[1]}-${pad(Number(m[2]))}-${pad(day)}`);
    }
  }
  for (const re of [KO_MD, ZH_MD]) {
    for (const m of sentence.matchAll(re)) {
      let d = `${year}-${pad(Number(m[1]))}-${pad(Number(m[2]))}`;
      if (dayNum(d) > ed + 1) d = `${year - 1}-${d.slice(5)}`;
      cands.push(d);
    }
  }
  if (/지난해|작년|去年/.test(sentence)) cands.push(`${year - 1}-12-31`);
  for (const d of cands) if (Number.isFinite(dayNum(d)) && ed - dayNum(d) > STALE_DAYS) return d;
  const rel = REL_AGO.exec(sentence);
  if (rel) {
    const n = Number(rel[1]);
    const unitDays = /주|周/.test(rel[2]) ? 7 : /년|年/.test(rel[2]) ? 365 : 30;
    if (n * unitDays > STALE_DAYS) return `${n}${rel[2]} 전`;
  }
  return null;
}

/**
 * 예전 사건을 시점 표시 없이 오늘 일처럼 썼나 (2026-10-28 "OpenAI 나비에-스토크스 증명 공개" — 공개는 9월 8일).
 * 브리핑 문장의 사건 동사(공개·발표·출시…)와 고유명사가 함께 나오는 근거 문장이 모두 예전 날짜를 달고 있으면 위반.
 * 같은 고유명사·동사가 날짜 없이(오늘 일로) 나오는 근거 문장이 하나라도 있으면 통과.
 * 인용 기사 자체가 편집일보다 STALE_DAYS 넘게 전 기사(news_date)여도 같은 규칙.
 */
export function staleEventIssues(text: string, docs: SourceDoc[], editionDate: string | undefined): RuleIssue[] {
  if (!editionDate || !docs.length) return [];
  const out: RuleIssue[] = [];
  const ed = dayNum(editionDate);
  const oldDocs = docs.filter((d) => d.news_date && ed - dayNum(d.news_date) > STALE_DAYS);
  if (oldDocs.length && oldDocs.length === docs.length && !BRIEF_TIME_RE.test(text))
    out.push({ rule: "stale_event", detail: `근거 기사가 모두 ${oldDocs[0].news_date} 이전 기사 — 시점을 밝히십시오` });
  for (const s of splitSentences(text)) {
    if (BRIEF_TIME_RE.test(s)) continue;
    if (!(s.match(EVENT_VERB_RE) ?? []).length) continue;
    const nouns = properNouns(s);
    if (!nouns.length) continue;
    const hasVerb = (x: string) => (x.match(EVENT_VERB_RE) ?? []).length > 0;
    const docSents = docs.map((d) => [d.title_kr, ...splitSentences(d.summary_kr), ...splitSentences(d.insight_kr ?? ""), ...splitSentences(d.summary_cn ?? "")]);
    for (const n of nouns) {
      // 사건 동사는 한 묶음으로 본다 (브리핑 "공개" ↔ 근거 "발표했다" 도 같은 사건).
      // 기사 단위: 그 실체+사건 동사 문장에 예전 날짜가 있거나, 고유명사 없는 사건 문장("논문 공개 약 7주 뒤")에 예전 시점이 있으면 예전 사건 기사
      let relevant = 0;
      let staleAt: string | null = null;
      let allStale = true;
      for (const ss of docSents) {
        const rel = ss.filter((x) => n.matches(x) && hasVerb(x));
        if (!rel.length) continue;
        relevant++;
        const direct = rel.map((x) => staleDateIn(x, editionDate)).find((x) => x !== null) ?? null;
        const generic = ss.filter((x) => hasVerb(x) && !properNouns(x).length).map((x) => staleDateIn(x, editionDate)).find((x) => x !== null) ?? null;
        const freshDated = rel.some((x) => /\d{1,2}월\s?\d{1,2}일|\d{1,2}月\d{1,2}日/.test(x) && staleDateIn(x, editionDate) === null);
        const st = freshDated ? null : direct ?? generic;
        if (st === null) allStale = false;
        else staleAt = staleAt ?? st;
      }
      if (relevant && allStale && staleAt) {
        out.push({ rule: "stale_event", detail: `${n.label}: 근거 기사의 사건 시점 ${staleAt} — 오늘 일처럼 쓰지 말고 "지난 ○월" 처럼 시점을 밝히십시오` });
        break;
      }
    }
  }
  return out;
}

// ───────────────────────── 돈

const KO_AMOUNT_RE = /(\d[\d,]*(?:\.\d+)?)\s?(조|억|만)?\s?(?:(\d[\d,]*(?:\.\d+)?)\s?(억|만)\s?)?(?:(\d[\d,]*(?:\.\d+)?)\s?(만)\s?)?(위안|달러|홍콩달러|엔|유로)/g;
const KO_TO_ZH_UNIT: Record<string, string> = { 조: "万亿", 억: "亿", 만: "万" };
const DEAL_VERB_BRIEF = /확보|유치|조달|투자|인수|거래|펀딩|라운드|모금|모집|받았|받아/;
const VALUE_RE = /매출|영업이익|순이익|이익|손실|적자|기업가치|밸류|가치|시가총액|시총|营收|收入|估值|市值|狂揽|利润|亏损|净利|营业额|销售额|入账/;
const DEAL_RE = /融资|投资|收购|募资|募集|融得|并购|증자|투자|유치|조달|인수|펀딩|라운드|채권|부채|대출|债|贷款/;

export interface AmountMention {
  raw: string;
  /** 한국어 첫 수 + 단위 (예: "110억") */
  head: string;
  /** 중국어 원문에서 찾을 꼴 (예: "110亿") */
  zh: string | null;
  currency: "CNY" | "USD" | "HKD" | "OTHER";
  index: number;
}

export function amountMentions(text: string): AmountMention[] {
  const out: AmountMention[] = [];
  for (const m of text.matchAll(KO_AMOUNT_RE)) {
    const num = m[1].replace(/,/g, "");
    const unit = m[2] ?? "";
    const cur = m[7];
    out.push({
      raw: m[0].trim(),
      head: `${num}${unit}`,
      zh: unit ? `${num}${KO_TO_ZH_UNIT[unit]}` : null,
      currency: cur === "위안" ? "CNY" : cur === "달러" ? "USD" : cur === "홍콩달러" ? "HKD" : "OTHER",
      index: m.index ?? 0,
    });
  }
  return out;
}

/** 중국어 원문 금액 뒤 통화. 단위만 있고 통화가 없으면("最大一笔110亿") 위안으로 본다 (중국 매체 관례) */
function zhCurrencyAfter(after: string): "CNY" | "USD" | "HKD" {
  if (/^\s*(?:美元|美金|USD|\$)/.test(after)) return "USD";
  if (/^\s*(?:港元|港币|HKD)/.test(after)) return "HKD";
  return "CNY";
}

/**
 * 금액 규칙 (데일리·주간·월간 공통):
 *  - money_not_deal: "163억 달러 확보" — 원문에서 그 금액은 매출·기업가치·손실(营收·估值·狂揽)로만 나오고 거래(融资·投资·收购)로는 안 나옴
 *  - currency_mismatch: "110억 달러" — 중국어 원문에는 110亿(위안)만 있고 달러는 없음 (원천 번역 오류 전파)
 *  - amount_not_in_source: "162억 달러" — 근거에 162억 9,000만 달러뿐 (금액을 잘라 씀)
 */
export function moneyIssues(text: string, docs: SourceDoc[], groundKo?: string): RuleIssue[] {
  const out: RuleIssue[] = [];
  if (!docs.length) return out;
  const zhText = docs.map((d) => `${d.title_cn} ${d.summary_cn ?? ""}`).join(" ");
  const koBody = docs.flatMap((d) => [d.title_kr, ...splitSentences(d.summary_kr), ...splitSentences(d.insight_kr ?? "")]);
  const zhSents = docs.flatMap((d) => [d.title_cn, ...splitSentences(d.summary_cn ?? "")]);
  const ground = flat(groundKo ?? docs.map((d) => `${d.title_kr} ${d.summary_kr} ${d.insight_kr ?? ""}`).join(" "));
  for (const a of amountMentions(text)) {
    // 금액 전체(단위·통화 포함)가 근거에 그대로 있어야 한다
    if (!hasNumberToken(ground, flat(a.raw))) {
      out.push({ rule: "amount_not_in_source", detail: `"${a.raw}" — 근거 기사에 같은 금액·통화 표기가 없음` });
    }
    if (a.zh) {
      const zhHits = [...zhText.matchAll(new RegExp(`(?<![\\d.])${a.zh.replace(/\./g, "\\.")}`, "g"))].map((m) =>
        zhCurrencyAfter(zhText.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 4))
      );
      if (zhHits.length && (a.currency === "USD" || a.currency === "CNY") && !zhHits.includes(a.currency)) {
        out.push({ rule: "currency_mismatch", detail: `"${a.raw}" — 중국어 원문은 ${a.zh}${zhHits[0] === "CNY" ? "(위안)" : zhHits[0] === "USD" ? "美元" : "港元"}` });
      }
    }
    const win = text.slice(Math.max(0, a.index - 12), a.index + a.raw.length + 12);
    const wide = text.slice(Math.max(0, a.index - 25), a.index + a.raw.length + 25);
    if (DEAL_VERB_BRIEF.test(win) && !VALUE_RE.test(wide)) {
      const koOcc = koBody.filter((s) => hasNumberToken(flat(s), flat(a.head)));
      const zhOcc = a.zh ? zhSents.filter((s) => hasNumberToken(flat(s), a.zh!)) : [];
      const occ = [...koOcc, ...zhOcc];
      const roleOf = (s: string) => {
        const fs = flat(s);
        const hit = new RegExp(`(?<![\\d.])${escapeRe(flat(a.head))}`).exec(fs) ?? (a.zh ? new RegExp(`(?<![\\d.])${escapeRe(a.zh)}`).exec(fs) : null);
        const i = hit?.index ?? 0;
        const w = fs.slice(Math.max(0, i - 12), i + 16);
        return { value: VALUE_RE.test(w), deal: DEAL_RE.test(w) };
      };
      const roles = occ.map(roleOf);
      if (roles.length && roles.some((r) => r.value) && !roles.some((r) => r.deal && !r.value))
        out.push({ rule: "money_not_deal", detail: `"${a.raw}" — 원문에서 이 금액은 매출·기업가치·손실이지 투자·조달 금액이 아님` });
    }
  }
  return out;
}

/** 주간·월간 money 문단: 금액 크기 비교·서열 금지 (같은 통화여도) */
const MONEY_RANK_RE = /최대 (?:거래|규모|딜)|가장 큰|가장 많|상대적으로|작았|컸다|규모가 컸|규모가 작|최소 규모|이번 (?:주|달)\s?최대/;
export function moneyRankIssue(text: string): RuleIssue | null {
  const m = text.match(MONEY_RANK_RE);
  return m ? { rule: "money_rank", detail: `"${m[0]}" — 금액끼리 크기를 비교하거나 서열을 매기지 않습니다` } : null;
}

// ───────────────────────── 수리 지시문 누출

const LEAK_RE = /표기\s?대신|대신\s?['"‘“]|표기로\s?(?:바꾸|수정|통일)|\[(?:han_in_ko|length|headline_length|number_not_in_source|number_unit_not_in_source|unsupported_entity|china_attribution|china_centric|qualifier_dropped)\]|lede_refs|primary_ref|subject_is_chinese|ARTICLES|STORIES|FACTS/;
export function leakedInstruction(text: string): RuleIssue | null {
  const m = text.match(LEAK_RE);
  return m ? { rule: "leaked_instruction", detail: `수리 지시·메타 문구가 본문에 남음: "${m[0]}"` } : null;
}

// ───────────────────────── 헤드라인 = 1위 기사

const HANGUL_TOKEN = /[가-힣A-Za-z0-9][가-힣A-Za-z0-9.\-]+/g;

/**
 * 헤드라인이 top_stories[0] 의 주체·사건을 다루는가. subject 문자열·고유명사·한글 이름 토큰 중 하나라도 겹치면 통과.
 * 1위 기사의 주체를 알 수 없으면(이름이 없음) 판단하지 않는다.
 */
export function headlineTopIssue(headline: string, top: { subject?: string; title?: string } | undefined): RuleIssue | null {
  if (!top) return null;
  const subj = (top.subject ?? "").trim();
  const ref = `${subj} ${top.title ?? ""}`;
  const h = flat(headline);
  if (subj && h.includes(flat(subj))) return null;
  const nouns = properNouns(ref);
  if (nouns.some((n) => n.matches(headline))) return null;
  const subjTokens = (subj.match(HANGUL_TOKEN) ?? []).filter((t) => t.length >= 2);
  const headTokens = (headline.match(HANGUL_TOKEN) ?? []).filter((t) => t.length >= 2);
  if (subjTokens.some((t) => h.includes(flat(t)))) return null;
  if (subj && headTokens.some((t) => /[가-힣]/.test(t) && flat(subj).startsWith(flat(t).replace(/[은는이가의,·]$/, "")) && t.length >= 2)) return null;
  if (!subj && !nouns.length) return null;
  return { rule: "headline_not_top_story", detail: `헤드라인이 1위 기사(${subj || top.title})를 다루지 않음 — 1위 기사의 사건으로 쓰십시오` };
}

// ───────────────────────── 중국어 원문에 없는 중국 기업 (원천 오역 전파)

const HAN_ALIAS = (e: Entity) => e.aliases.some((a) => typeof a === "string" ? /[一-鿿]/.test(a) : /[一-鿿]/.test(a.source));

/**
 * 문장의 중국 실체가 근거 기사의 한국어 번역에는 있는데 중국어 원문(title_cn·summary_cn)에는 없음.
 * (04-14 "화웨이와 샤오미·아너" — 원문 "荣耀…小米", title_kr 오역 "화웨이와 비비오크" 가 전파)
 * 중국어 요약(summary_cn)이 있는 근거 기사만 본다. 정부·기관(cn_gov)은 표기가 다양해 뺀다.
 */
export function entityNotInOriginal(text: string, docs: SourceDoc[]): RuleIssue[] {
  // 중국어 요약까지 있는 기사만 (제목만으로는 한국어 요약 전체와 대조할 수 없다)
  const withZh = docs.filter((d) => (d.summary_cn ?? "").trim());
  if (!withZh.length) return [];
  const out: RuleIssue[] = [];
  for (const e of findEntities(text)) {
    if (!e.chinese || e.key === "cn_gov" || !HAN_ALIAS(e)) continue;
    const inKo = withZh.filter((d) => entityMentioned(e, `${d.title_kr} ${d.summary_kr}`));
    if (!inKo.length) continue;
    if (!withZh.some((d) => entityMentioned(e, `${d.title_cn} ${d.summary_cn ?? ""}`)))
      out.push({ rule: "entity_not_in_original", detail: `${e.key}: 한국어 번역에만 있고 중국어 원문에는 없음 (원천 번역 오류 의심)` });
  }
  return out;
}

// ───────────────────────── 매체 수 주장

const KO_COUNT: Record<string, number> = { 두: 2, 세: 3, 네: 4, 다섯: 5, 여섯: 6, 여러: 2 };
const OUTLET_RE = /(두|세|네|다섯|여섯|여러|\d+)\s?(?:개\s?)?(?:곳의\s?)?(?:매체|언론)/;
/** "두 매체가 전했다" 인데 근거 기사들의 매체 수가 그보다 적음 */
export function outletClaimIssue(text: string, outlets: string[]): RuleIssue | null {
  const m = text.match(OUTLET_RE);
  if (!m) return null;
  const n = KO_COUNT[m[1]] ?? Number(m[1]);
  const have = new Set(outlets.filter(Boolean)).size;
  return n > have ? { rule: "outlet_count", detail: `"${m[0]}" — 근거 기사 매체는 ${have}곳` } : null;
}

