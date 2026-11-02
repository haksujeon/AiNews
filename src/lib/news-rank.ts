/**
 * 기사 "중요도" 순위 — 데일리 브리핑 후보 선정(briefing/select.ts)과 홈 목록의 "주요 4건"이
 * 같은 함수를 쓴다 (Gate 2: 같은 결과 = 같은 함수). 공식을 다른 곳에 다시 쓰지 말 것.
 *
 *  1. 전재 묶기: title_cn 이 같거나 한자 바이그램 Jaccard ≥ 0.6 이면 같은 글 (36氪·虎嗅 동시 게재 등)
 *  2. 묶음 점수 = 매체 수(coverage) + 매체 권위 + 카테고리 가중 + 기업 등급 + 구체 숫자
 *                 − 행사·모집 감점 − 칼럼·인터뷰 감점
 *                 − 한 매체만 다룬 해외 연구 논문 감점 + 중국 주요 기업의 큰 금액 가산 (2026-11-02 편집 QA 권고 15)
 *     + 사건 단위 매체 수(cross_coverage): 제목이 다른 같은 사건 묶음(sameEvent — 주간·월간 2단계 묶기와 같은 함수)의
 *       매체를 합쳐 coverage 를 다시 계산한 차이. Anthropic S-1 처럼 10여 건이 제목마다 갈라져도 사건 크기가 점수에 들어간다.
 *  3. 정렬: (홈 목록만) 발행된 브리핑의 주요 기사 순위 → 점수 내림차순 → 대표 기사 id (결정적)
 *
 * 이 파일은 DB 도 node:crypto 도 import 하지 않는다 (단위 테스트가 DATABASE_URL 없이 돈다).
 * 서버 코드에서만 부른다.
 */
import { ENTITIES, LATIN_STOP, findEntities, maxEntityTier } from "./briefing/entities";

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
/** 큰 금액: 10억 위안·1억 달러 이상 (억 단위 금액) */
const BIG_AMOUNT_RE = /\d[\d,.]*\s?(?:조|억)\s?(?:\d[\d,.]*\s?만\s?)?(?:위안|달러)|\d+(?:\.\d+)?\s?(?:万亿|亿)(?:元|美元|人民币)?/;
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

/** 묶음 점수. detail 은 관리자 화면·디버그용 항목별 점수 */
export function scoreGroup(members: RankableArticle[]): { score: number; detail: Record<string, number> } {
  const sources = new Set(members.map((m) => m.source_name));
  const text = members.map((m) => `${s(m.title_kr)} ${s(m.title_cn)} ${s(m.summary_kr)}`).join(" ");
  const titles = members.map((m) => `${s(m.title_kr)} ${s(m.title_cn)}`).join(" ");
  const ents = findEntities(text);
  const chinese = ents.some((e) => e.chinese) || CHINA_PLACE_RE.test(text);
  const detail: Record<string, number> = {
    coverage: coverageScore(sources.size),
    source: Math.max(...members.map((m) => SOURCE_WEIGHT[s(m.source_name)] ?? 0.5)),
    category: Math.max(...members.map((m) => CATEGORY_WEIGHT[s(m.category)] ?? 0.5)),
    company: maxEntityTier(text),
    number: NUMBER_RE.test(text) ? 0.5 : 0,
    event: EVENT_RE.test(titles) ? -1 : 0,
    column: COLUMN_RE.test(titles) ? -0.5 : 0,
    // 한 매체만 다룬 해외 연구 논문 (10-27 MAI-DxO, 10-28 Meta World-T³ 가 중국 대형 사건보다 위에 왔다)
    foreign_paper: sources.size === 1 && !chinese && RESEARCH_RE.test(titles) ? -1.5 : 0,
    // 중국 주요 기업(등급 1) + 제목에 큰 금액 (딥시크 1000억 위안 라운드 등)
    cn_deal: findEntities(titles).some((e) => e.chinese && e.tier >= 1) && BIG_AMOUNT_RE.test(titles) ? 0.5 : 0,
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
  /** 사건 단위 매체 수 가산 (기본 true). 기간 지표(한 달 치 묶음)는 2단계 사건 묶기를 따로 하므로 false */
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

/** 묶음별 사건 (union-find, sameEvent). 반환: 묶음 index → 사건 전체 매체, 사건 대표 묶음 여부(점수가 가장 높은 묶음) */
function eventSourcesOf(groups: { members: RankableArticle[]; sources: string[]; base: number }[]): { sources: string[]; lead: boolean }[] {
  const feats: EventLike[] = groups.map((g) => {
    const p = g.members[0];
    const days = [...new Set(g.members.map((m) => s(m.news_date ?? m.day) || "1970-01-01"))];
    return {
      title_kr: s(p.title_kr),
      title_cn: s(p.title_cn),
      days,
      entities: findEntities(g.members.map((m) => `${s(m.title_kr)} ${s(m.title_cn)}`).join(" ")).map((e) => e.key),
    };
  });
  const parent = groups.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < groups.length; i++) {
    if (!feats[i].entities.length) continue;
    for (let j = i + 1; j < groups.length; j++) if (feats[j].entities.length && sameEvent(feats[i], feats[j])) parent[find(j)] = find(i);
  }
  const byRoot = new Map<number, Set<string>>();
  const leadOf = new Map<number, number>();
  groups.forEach((g, i) => {
    const r = find(i);
    if (!byRoot.has(r)) byRoot.set(r, new Set());
    g.sources.forEach((x) => byRoot.get(r)!.add(x));
    const cur = leadOf.get(r);
    if (cur === undefined || g.base > groups[cur].base || (g.base === groups[cur].base && g.members[0].id < groups[cur].members[0].id)) leadOf.set(r, i);
  });
  return groups.map((_, i) => ({ sources: [...byRoot.get(find(i))!], lead: leadOf.get(find(i)) === i }));
}

/**
 * 묶기 + 점수 + 정렬. 같은 입력이면 언제나 같은 순서 (결정적).
 * cited 가 있으면 브리핑에 실린 묶음이 먼저 (편집 검토를 거친 판단이므로), 그다음 점수 순.
 */
export function rankStories<T extends RankableArticle>(articles: T[], opts: RankOptions = {}): RankedStory<T>[] {
  const cited = opts.cited;
  const groups = dedupeReposts(articles).map((members) => ({
    members,
    sources: [...new Set(members.map((m) => m.source_name).filter((x): x is string => !!x))],
    scored: scoreGroup(members),
  }));
  const ev =
    opts.eventCoverage === false
      ? groups.map((g) => ({ sources: g.sources, lead: true }))
      : eventSourcesOf(groups.map((g) => ({ members: g.members, sources: g.sources, base: g.scored.score })));
  const evSources = ev.map((e) => e.sources);
  const stories = groups.map(({ members, sources, scored }, gi) => {
    const primary = pickPrimary(members);
    const base = scored;
    // 사건 단위 매체 수 가산은 사건의 대표 묶음(점수 최고)에만 — 같은 사건 묶음이 상위를 다 차지하지 않게
    const cross = ev[gi].lead ? Math.max(0, coverageScore(evSources[gi].length) - coverageScore(sources.length)) : 0;
    const detail = { ...base.detail, cross_coverage: Math.round(cross * 1000) / 1000 };
    const score = Math.round((base.score + cross) * 1000) / 1000;
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
      score,
      scoreDetail: detail,
      citedRank,
      eventSources: evSources[gi],
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
