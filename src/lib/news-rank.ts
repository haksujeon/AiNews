/**
 * 기사 "중요도" 순위 — 데일리 브리핑 후보 선정(briefing/select.ts)과 홈 목록의 "주요 4건"이
 * 같은 함수를 쓴다 (Gate 2: 같은 결과 = 같은 함수). 공식을 다른 곳에 다시 쓰지 말 것.
 *
 *  1. 전재 묶기: title_cn 이 같거나 한자 바이그램 Jaccard ≥ 0.6 이면 같은 글 (36氪·虎嗅 동시 게재 등)
 *  2. 묶음 점수 = 매체 수(coverage) + 매체 권위 + 카테고리 가중 + 기업 등급 + 구체 숫자
 *                 − 행사·모집 감점 − 칼럼·인터뷰 감점
 *                 − 한 매체만 다룬 해외 연구 논문 감점 + 중국 주요 기업의 큰 금액 가산 (2026-11-02 편집 QA 권고 15)
 *     (예전 cross_coverage — 같은 사건 묶음의 매체를 합친 가산 — 은 2026-11-09 P3 "같은 사건 합치기"로 바뀌었다: 아래)
 *  3. 정렬: (홈 목록만) 발행된 브리핑의 주요 기사 순위 → 점수 내림차순 → 대표 기사 id (결정적)
 *
 * 2026-11-09 개선 (비교표 P2·P3·P5, 사용자 결정 "반영"):
 *  - P3 같은 사건 합치기: sameEvent 로 같은 사건인 전재 묶음을 한 이야기로 합친다 (후보 40칸을 같은 사건이 여러 칸 차지하지 않게).
 *    합친 이야기의 매체 수가 곧 사건 단위 매체 수라 cross_coverage 가산은 없어졌다.
 *  - P2 옮겨 실은 매체: 전재 묶음마다 대표 기사 매체 1, 같은 글을 옮겨 실은 매체 0.5 (매체별 최대값의 합)로 coverage 를 센다.
 *  - P5 사건의 무게: 큰 금액(달러 환산 1억 +0.5 · 10억 +1 · 100억 +1.5)은 투자·매출·인수·상장 제목에만,
 *    발표·출시·공개·실적 같은 사건 제목 +0.5, 표기 사전의 회사·기관이 나오면 기업 등급 최소 0.5. (cn_deal 은 amount 로 바뀌었다)
 *  - P4 최근 판 겹침: 점수는 깎지 않고 recentRepeatOf 로 "최근 3개 판에 실린 같은 회사 이야기" 표시만 (프롬프트에 보여 준다).
 *
 * 이 파일은 DB 도 node:crypto 도 import 하지 않는다 (단위 테스트가 DATABASE_URL 없이 돈다).
 * 서버 코드에서만 부른다.
 */
import { ENTITIES, LATIN_STOP, findEntities, maxEntityTier } from "./briefing/entities";
import { KO_GLOSSARY } from "./text/ko-glossary";

/** 순위 계산에 필요한 최소 필드. NewsItem 과 CandidateArticle 이 모두 만족한다. */
export interface RankableArticle {
  id: string;
  source_name: string | null;
  category: string | null;
  title_cn: string | null;
  title_kr: string | null;
  summary_kr: string | null;
  /** 베이징 날짜 (있으면 사건 묶기의 날짜 차이에 쓴다. 없으면 같은 날로 본다) */
  news_date?: string | null;
  day?: string | null;
}

export const REPOST_JACCARD = 0.6;

/** source_name 은 DB 에 영문으로 들어 있다 (36Kr, Huxiu, Qbitai, ITHome, Synced, XinZhiYuan) */
export const SOURCE_WEIGHT: Record<string, number> = {
  Qbitai: 1.0,
  Synced: 1.0,
  XinZhiYuan: 1.0,
  "36Kr": 0.8,
  ITHome: 0.7,
  Huxiu: 0.6,
};

export const CATEGORY_WEIGHT: Record<string, number> = {
  "ai-tech": 1.0,
  "ai-product": 1.0,
  "ai-biz": 0.8,
  // 로봇(로봇 범위 v3): AI 초점이 흐려지지 않게 ai-biz 와 같은 0.8
  robotics: 0.8,
};

const EVENT_RE = /모집|공모|참가자|신청 접수|대회 개최|행사|포럼|컨퍼런스|招募|报名|大赛|峰会|论坛|开幕/;
const COLUMN_RE = /칼럼|기고|인터뷰|대담|회고|에세이|专栏|对话|访谈|随笔/;
const NUMBER_RE = /\d[\d,.]*\s?(?:%|억|만|위안|달러|명|개|배|MW|GW|B\b)/;
/** 연구·논문·벤치마크 기사 (한 매체만 다룬 해외 연구는 감점) */
const RESEARCH_RE = /논문|연구진|연구팀|arXiv|프리프린트|论文|研究团队|研究人员/;
const CHINA_PLACE_RE = /중국|中国|国产|국산|베이징|상하이|선전|항저우|北京|上海|深圳|杭州|칭화|清华|베이징대|北大/;
/** P5: 거래·실적 제목 (금액 가산은 이런 제목에만 — 분석 글의 "3,000억 증발" 같은 금액은 빼려고) */
const DEAL_RE = /투자|라운드|펀딩|융자|融资|매출|营收|인수|收购|상장|IPO|베팅|규모/;
/** P5: 사건 제목 (대표 기사 제목에 있으면 +0.5) */
const EVENT_TYPE_RE = /출시|공개|발표|오픈소스|가중치|상장|IPO|실적|매출|투자 유치|라운드|인수|정책|규정|국무원|공업정보화부|发布|推出|开源|上市|财报|融资|收购|政策|印发/;
/** 위안 → 달러 (금액 등급 판정용 고정 환율 — 등급 경계만 보므로 일별 환율을 쓰지 않는다) */
const USD_PER_CNY = 1 / 7.1;
const AMOUNT_RE = /(\d[\d,.]*)\s?(조|억)\s?(?:(\d[\d,.]*)\s?만\s?)?(위안|달러)|(\d+(?:\.\d+)?)\s?(万亿|亿)(美元|元|人民币)?/g;
/** 제목 속 가장 큰 금액 (달러 환산) */
export function maxAmountUsd(text: string): number {
  let best = 0;
  for (const m of text.matchAll(AMOUNT_RE)) {
    let v: number;
    let usdUnit: boolean;
    if (m[1]) {
      v = parseFloat(m[1].replace(/,/g, "")) * (m[2] === "조" ? 1e12 : 1e8);
      usdUnit = m[4] === "달러";
    } else {
      v = parseFloat(m[5]) * (m[6] === "万亿" ? 1e12 : 1e8);
      usdUnit = m[7] === "美元";
    }
    const usd = usdUnit ? v : v * USD_PER_CNY;
    if (Number.isFinite(usd) && usd > best) best = usd;
  }
  return best;
}
export const amountScore = (usd: number) => (usd >= 1e10 ? 1.5 : usd >= 1e9 ? 1 : usd >= 1e8 ? 0.5 : 0);
/** 표기 사전(ko-glossary)의 회사·기관 이름 (실체 이름표에 없는 회사도 기업 점수 최소 0.5) */
const GLOSS_COMPANY_NAMES = KO_GLOSSARY.filter((e) => e.kind === "company" || e.kind === "org")
  .flatMap((e) => [e.ko, ...(e.zh ?? []), ...(e.en ? [e.en] : [])])
  .filter((x): x is string => typeof x === "string" && x.length >= 2);
const hasGlossCompany = (t: string) => GLOSS_COMPANY_NAMES.some((n) => t.includes(n));

/** 매체 수 가중 (2026-11-02: 3 → 4, 여러 매체가 다룬 사건을 더 앞으로) */
export const COVERAGE_WEIGHT = 4;
export const coverageScore = (sources: number) => COVERAGE_WEIGHT * Math.log2(1 + sources);

const s = (v: string | null | undefined) => v ?? "";

/** 공백·문장부호를 뺀 문자 바이그램 */
export function bigrams(text: string | null | undefined): Set<string> {
  const t = s(text).replace(/[\s\p{P}\p{S}]+/gu, "");
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size && !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** 전재(같은 글) 묶기 — union-find. 반환: 묶음 배열 (각 묶음은 입력 순서를 지킨 기사 배열) */
export function dedupeReposts<T extends RankableArticle>(articles: T[], threshold = REPOST_JACCARD): T[][] {
  const parent = articles.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const grams = articles.map((a) => bigrams(a.title_cn));
  for (let i = 0; i < articles.length; i++) {
    for (let j = i + 1; j < articles.length; j++) {
      const same =
        (articles[i].title_cn && articles[i].title_cn!.trim() === articles[j].title_cn?.trim()) ||
        jaccard(grams[i], grams[j]) >= threshold;
      if (same) parent[find(j)] = find(i);
    }
  }
  const groups = new Map<number, T[]>();
  articles.forEach((a, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(a);
  });
  return [...groups.values()];
}

/**
 * 이야기 점수. detail 은 관리자 화면·디버그용 항목별 점수.
 * opts.independent: 독립 매체 수(P2 — 옮겨 실은 매체 0.5). 없으면 매체 수 그대로.
 * opts.leadTitle: 대표 기사 제목 (사건 제목 가산). 없으면 첫 기사 제목.
 */
export function scoreGroup(
  members: RankableArticle[],
  opts: { independent?: number; leadTitle?: string } = {}
): { score: number; detail: Record<string, number> } {
  const sources = new Set(members.map((m) => m.source_name));
  const text = members.map((m) => `${s(m.title_kr)} ${s(m.title_cn)} ${s(m.summary_kr)}`).join(" ");
  const titles = members.map((m) => `${s(m.title_kr)} ${s(m.title_cn)}`).join(" ");
  const ents = findEntities(text);
  const chinese = ents.some((e) => e.chinese) || CHINA_PLACE_RE.test(text);
  const leadTitle = opts.leadTitle ?? `${s(members[0]?.title_kr)} ${s(members[0]?.title_cn)}`;
  const detail: Record<string, number> = {
    coverage: coverageScore(opts.independent ?? sources.size),
    source: Math.max(...members.map((m) => SOURCE_WEIGHT[s(m.source_name)] ?? 0.5)),
    category: Math.max(...members.map((m) => CATEGORY_WEIGHT[s(m.category)] ?? 0.5)),
    company: maxEntityTier(text) || (hasGlossCompany(titles) ? 0.5 : 0),
    number: NUMBER_RE.test(text) ? 0.5 : 0,
    event: EVENT_RE.test(titles) ? -1 : 0,
    column: COLUMN_RE.test(titles) ? -0.5 : 0,
    // 한 매체만 다룬 해외 연구 논문 (10-27 MAI-DxO, 10-28 Meta World-T³ 가 중국 대형 사건보다 위에 왔다)
    foreign_paper: sources.size === 1 && !chinese && RESEARCH_RE.test(titles) ? -1.5 : 0,
    // P5 (2026-11-09): 큰 금액은 투자·매출·인수·상장 제목에만 (예전 cn_deal 대신)
    amount: DEAL_RE.test(titles) ? amountScore(maxAmountUsd(titles)) : 0,
    event_type: EVENT_TYPE_RE.test(leadTitle) ? 0.5 : 0,
  };
  const score = Object.values(detail).reduce((sum, v) => sum + v, 0);
  return { score: Math.round(score * 1000) / 1000, detail };
}

/** 대표 기사: 매체 가중이 높고 요약이 긴 쪽 */
export function pickPrimary<T extends RankableArticle>(members: T[]): T {
  return [...members].sort(
    (a, b) =>
      (SOURCE_WEIGHT[s(b.source_name)] ?? 0) - (SOURCE_WEIGHT[s(a.source_name)] ?? 0) ||
      s(b.summary_kr).length - s(a.summary_kr).length ||
      a.id.localeCompare(b.id)
  )[0];
}

export interface RankedStory<T extends RankableArticle> {
  primary: T;
  /** 같은 글을 실은 다른 기사 (전재) */
  siblings: T[];
  /** 대표 + 형제의 매체명 (중복 제거, null 제외) */
  sources: string[];
  score: number;
  scoreDetail: Record<string, number>;
  /** 발행된 브리핑의 주요 기사 순위(1부터). 인용되지 않았으면 null */
  citedRank: number | null;
  /** 같은 사건(제목이 다른 묶음 포함)을 다룬 매체 전체 (eventCoverage 가 꺼져 있으면 sources 와 같다) */
  eventSources: string[];
}

export interface RankOptions {
  /** 기사 id → 브리핑 주요 기사 순위(1부터). 묶음 안 기사 중 가장 높은 순위를 쓴다. */
  cited?: ReadonlyMap<string, number>;
  /** 같은 사건 합치기 (기본 true, P3). 기간 지표(한 달 치 묶음)는 2단계 사건 묶기를 따로 하므로 false */
  eventCoverage?: boolean;
}

// ───────────────────────── 사건 묶기 (2단계) — 주간·월간 groupPeriodStories 와 데일리·홈 점수가 같은 판정을 쓴다

/** 같은 사건 판정 기준 (select.ts 가 다시 내보낸다) */
export const EVENT_TITLE_JACCARD = 0.3;
export const EVENT_MAX_DAY_GAP = 2;

const ALIAS_STRINGS = new Set(ENTITIES.flatMap((e) => e.aliases.filter((a): a is string => typeof a === "string").map((a) => a.toLowerCase())));

/** 제목의 영문 제품 토큰 (숫자를 포함한 3자 이상, 또는 대문자로 시작하는 4자 이상). 실체 별칭·일반 약어는 뺀다 */
export function productTokens(title: string): Set<string> {
  const out = new Set<string>();
  for (const tok of title.match(/[A-Za-z][A-Za-z0-9]*(?:[.\-+][A-Za-z0-9]+)*/g) ?? []) {
    if (LATIN_STOP.has(tok) || ALIAS_STRINGS.has(tok.toLowerCase())) continue;
    const hasDigit = /\d/.test(tok);
    if ((hasDigit && tok.length >= 3) || (/^[A-Z]/.test(tok) && tok.length >= 4)) out.add(tok.toLowerCase());
  }
  return out;
}

const dayNum = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;

/** 사건 묶기 입력의 최소 모양 */
export interface EventLike {
  title_kr: string;
  title_cn: string;
  days: string[];
  entities: string[];
}

/** 두 1단계 묶음이 같은 사건인가: 같은 실체 + ±2일 + (같은 제품 토큰 또는 한국어 제목 바이그램 Jaccard ≥ 0.3) */
export function sameEvent(a: EventLike, b: EventLike): boolean {
  if (!a.entities.some((e) => b.entities.includes(e))) return false;
  const gap = Math.min(...a.days.flatMap((x) => b.days.map((y) => Math.abs(dayNum(x) - dayNum(y)))));
  if (!(gap <= EVENT_MAX_DAY_GAP)) return false;
  const ta = productTokens(`${a.title_kr} ${a.title_cn}`);
  const tb = productTokens(`${b.title_kr} ${b.title_cn}`);
  for (const t of ta) if (tb.has(t)) return true;
  return jaccard(bigrams(a.title_kr), bigrams(b.title_kr)) >= EVENT_TITLE_JACCARD;
}

/** 전재 묶음의 사건 판정 입력 (실체·날짜·대표 제목) */
function eventFeat(members: RankableArticle[]): EventLike {
  const p = members[0];
  return {
    title_kr: s(p.title_kr),
    title_cn: s(p.title_cn),
    days: [...new Set(members.map((m) => s(m.news_date ?? m.day) || "1970-01-01"))],
    entities: findEntities(members.map((m) => `${s(m.title_kr)} ${s(m.title_cn)}`).join(" ")).map((e) => e.key),
  };
}

/** 전재 묶음 → 같은 사건끼리 (union-find, sameEvent). 반환: 사건마다 묶음 index 목록 */
function eventClusters(groups: { members: RankableArticle[] }[]): number[][] {
  const feats = groups.map((g) => eventFeat(g.members));
  const parent = groups.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < groups.length; i++) {
    if (!feats[i].entities.length) continue;
    for (let j = i + 1; j < groups.length; j++) if (feats[j].entities.length && sameEvent(feats[i], feats[j])) parent[find(j)] = find(i);
  }
  const byRoot = new Map<number, number[]>();
  groups.forEach((_, i) => {
    const r = find(i);
    if (!byRoot.has(r)) byRoot.set(r, []);
    byRoot.get(r)!.push(i);
  });
  return [...byRoot.values()];
}

/** P2: 독립 매체 수 — 전재 묶음마다 대표 기사 매체 1, 옮겨 실은 매체 0.5 (매체별 최대값의 합) */
export function independentOutlets(repostGroups: RankableArticle[][]): number {
  const w = new Map<string, number>();
  for (const g of repostGroups) {
    const prim = pickPrimary(g);
    for (const m of g) {
      const src = s(m.source_name);
      if (!src) continue;
      w.set(src, Math.max(w.get(src) ?? 0, m.id === prim.id ? 1 : 0.5));
    }
  }
  return [...w.values()].reduce((a, b) => a + b, 0);
}

/**
 * 묶기 + 점수 + 정렬. 같은 입력이면 언제나 같은 순서 (결정적).
 * 1단계 전재 묶기 → 2단계 같은 사건 합치기(P3, eventCoverage 가 false 면 하지 않음) → 이야기 점수(P2 독립 매체 수·P5).
 * cited 가 있으면 브리핑에 실린 이야기가 먼저 (편집 검토를 거친 판단이므로), 그다음 점수 순.
 */
export function rankStories<T extends RankableArticle>(articles: T[], opts: RankOptions = {}): RankedStory<T>[] {
  const cited = opts.cited;
  const groups = dedupeReposts(articles).map((members) => ({ members, base: scoreGroup(members).score }));
  const clusters = opts.eventCoverage === false ? groups.map((_, i) => [i]) : eventClusters(groups);
  const stories = clusters.map((idx) => {
    // 사건의 대표 묶음 = 점수가 가장 높은 전재 묶음 (같으면 첫 기사 id)
    const gs = idx.map((i) => groups[i]).sort((a, b) => b.base - a.base || a.members[0].id.localeCompare(b.members[0].id));
    const members = gs.flatMap((g) => g.members);
    const primary = pickPrimary(gs[0].members);
    const sources = [...new Set(members.map((m) => m.source_name).filter((x): x is string => !!x))];
    const scored = scoreGroup(members, { independent: independentOutlets(gs.map((g) => g.members)), leadTitle: `${s(primary.title_kr)} ${s(primary.title_cn)}` });
    let citedRank: number | null = null;
    if (cited) {
      for (const m of members) {
        const r = cited.get(m.id);
        if (r !== undefined && (citedRank === null || r < citedRank)) citedRank = r;
      }
    }
    return {
      primary,
      siblings: members.filter((m) => m.id !== primary.id),
      sources,
      score: scored.score,
      scoreDetail: scored.detail,
      citedRank,
      eventSources: sources,
    } satisfies RankedStory<T>;
  });
  stories.sort(
    (a, b) =>
      (a.citedRank ?? Infinity) - (b.citedRank ?? Infinity) ||
      b.score - a.score ||
      a.primary.id.localeCompare(b.primary.id)
  );
  return stories;
}

// ───────────────────────── P4 최근 판 겹침 (점수에 넣지 않고 표시만)

/** 최근 판에 실린 주요 기사 하나 (제목들·실체·날짜) */
export interface RecentStory {
  /** 표시 문구 (예: "11-04 판: 딥시크, 두 번째 투자 유치 규모 1055억 위안") */
  label: string;
  titles: string[];
  title_cn: string;
  days: string[];
  entities: string[];
}
/** 최근 판 겹침 기준: 같은 실체 + 4일 안 + (같은 영문 제품 토큰 또는 제목 쌍 바이그램 Jaccard ≥ 0.3) */
export const RECENT_MAX_DAY_GAP = 4;
export const RECENT_TITLE_JACCARD = 0.3;

/** 근거 기사 묶음 → 최근 판 겹침 판정 입력 (기사 제목들 + 브리핑 제목) */
export function recentStoryOf(label: string, title: string, members: RankableArticle[]): RecentStory {
  const f = eventFeat(members.length ? members : [{ id: "", source_name: null, category: null, title_cn: "", title_kr: title, summary_kr: null }]);
  return {
    label,
    titles: [title, ...members.map((m) => s(m.title_kr))].filter(Boolean),
    title_cn: f.title_cn,
    days: f.days,
    entities: findEntities([title, ...members.map((m) => `${s(m.title_kr)} ${s(m.title_cn)}`)].join(" ")).map((e) => e.key),
  };
}

/** 후보 이야기(대표 + 형제)가 최근 판 주요 기사와 같은 이야기면 그 표시 문구, 아니면 null */
export function recentRepeatOf(members: RankableArticle[], recent: readonly RecentStory[]): string | null {
  if (!recent.length || !members.length) return null;
  const f = eventFeat(members);
  const titles = members.map((m) => s(m.title_kr)).filter(Boolean);
  const tokA = productTokens([...titles, f.title_cn].join(" "));
  for (const r of recent) {
    if (!f.entities.some((e) => r.entities.includes(e))) continue;
    const gap = Math.min(...f.days.flatMap((x) => r.days.map((y) => Math.abs(dayNum(x) - dayNum(y)))));
    if (!(gap <= RECENT_MAX_DAY_GAP)) continue;
    const tokB = productTokens([...r.titles, r.title_cn].join(" "));
    if ([...tokA].some((t) => tokB.has(t))) return r.label;
    let best = 0;
    for (const x of titles) for (const y of r.titles) best = Math.max(best, jaccard(bigrams(x), bigrams(y)));
    if (best >= RECENT_TITLE_JACCARD) return r.label;
  }
  return null;
}

export const DAY_TOP_COUNT = 4;

export interface DaySplit<T extends RankableArticle> {
  /** 주요 기사 (묶음 대표, 최대 topCount 건 — 같은 글이 두 칸을 차지하지 않는다) */
  top: { item: T; outletCount: number }[];
  /**
   * 나머지 전부, 순위 순: 5위 이하 묶음(대표 → 형제) 다음에 주요 묶음의 전재 형제.
   * 펼친 사람에게는 "새 이야기"가 먼저 보여야 하므로 이미 본 글의 전재는 맨 뒤로 보낸다.
   */
  rest: { item: T; outletCount: number }[];
}

/**
 * 하루치 기사를 "주요 N건 + 나머지"로 나눈다. top.length + rest.length === articles.length.
 * 홈 목록의 첫 화면(top)과 펼치기(rest)가 모두 이 함수를 쓴다.
 */
export function splitDay<T extends RankableArticle>(
  articles: T[],
  opts: RankOptions & { topCount?: number } = {}
): DaySplit<T> {
  const topCount = opts.topCount ?? DAY_TOP_COUNT;
  const stories = rankStories(articles, opts);
  const top: DaySplit<T>["top"] = [];
  const rest: DaySplit<T>["rest"] = [];
  const topSiblings: DaySplit<T>["rest"] = [];
  stories.forEach((st, i) => {
    const outletCount = st.sources.length;
    if (i < topCount) {
      top.push({ item: st.primary, outletCount });
      // 같은 글이라도 기사 수는 total 과 맞아야 하므로 형제도 나머지에 넣는다 (맨 뒤)
      for (const sib of st.siblings) topSiblings.push({ item: sib, outletCount });
    } else {
      rest.push({ item: st.primary, outletCount });
      for (const sib of st.siblings) rest.push({ item: sib, outletCount });
    }
  });
  return { top, rest: [...rest, ...topSiblings] };
}

/**
 * 발행된 브리핑 content.top_stories → 기사 id 별 순위(1부터).
 * primary_ref 와 refs 모두 그 주요 기사의 순위를 받는다. 모양이 틀린 항목은 건너뛴다 (DB jsonb 라 any).
 */
export function citedRanksFromTopStories(topStories: unknown): Map<string, number> {
  const out = new Map<string, number>();
  if (!Array.isArray(topStories)) return out;
  topStories.forEach((st, i) => {
    if (!st || typeof st !== "object") return;
    const { rank, refs, primary_ref } = st as { rank?: unknown; refs?: unknown; primary_ref?: unknown };
    const r = typeof rank === "number" && rank > 0 ? rank : i + 1;
    const ids = [primary_ref, ...(Array.isArray(refs) ? refs : [])].filter(
      (x): x is string => typeof x === "string" && !!x
    );
    for (const id of ids) {
      const prev = out.get(id);
      if (prev === undefined || r < prev) out.set(id, r);
    }
  });
  return out;
}
