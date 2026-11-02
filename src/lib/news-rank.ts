/**
 * 기사 "중요도" 순위 — 데일리 브리핑 후보 선정(briefing/select.ts)과 홈 목록의 "주요 4건"이
 * 같은 함수를 쓴다 (Gate 2: 같은 결과 = 같은 함수). 공식을 다른 곳에 다시 쓰지 말 것.
 *
 *  1. 전재 묶기: title_cn 이 같거나 한자 바이그램 Jaccard ≥ 0.6 이면 같은 글 (36氪·虎嗅 동시 게재 등)
 *  2. 묶음 점수 = 매체 수(coverage) + 매체 권위 + 카테고리 가중 + 기업 등급 + 구체 숫자
 *                 − 행사·모집 감점 − 칼럼·인터뷰 감점
 *  3. 정렬: (홈 목록만) 발행된 브리핑의 주요 기사 순위 → 점수 내림차순 → 대표 기사 id (결정적)
 *
 * 이 파일은 DB 도 node:crypto 도 import 하지 않는다 (단위 테스트가 DATABASE_URL 없이 돈다).
 * 서버 코드에서만 부른다.
 */
import { maxEntityTier } from "./briefing/entities";

/** 순위 계산에 필요한 최소 필드. NewsItem 과 CandidateArticle 이 모두 만족한다. */
export interface RankableArticle {
  id: string;
  source_name: string | null;
  category: string | null;
  title_cn: string | null;
  title_kr: string | null;
  summary_kr: string | null;
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
};

const EVENT_RE = /모집|공모|참가자|신청 접수|대회 개최|행사|포럼|컨퍼런스|招募|报名|大赛|峰会|论坛|开幕/;
const COLUMN_RE = /칼럼|기고|인터뷰|대담|회고|에세이|专栏|对话|访谈|随笔/;
const NUMBER_RE = /\d[\d,.]*\s?(?:%|억|만|위안|달러|명|개|배|MW|GW|B\b)/;

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
  const detail: Record<string, number> = {
    coverage: 3 * Math.log2(1 + sources.size),
    source: Math.max(...members.map((m) => SOURCE_WEIGHT[s(m.source_name)] ?? 0.5)),
    category: Math.max(...members.map((m) => CATEGORY_WEIGHT[s(m.category)] ?? 0.5)),
    company: maxEntityTier(text),
    number: NUMBER_RE.test(text) ? 0.5 : 0,
    event: EVENT_RE.test(titles) ? -1 : 0,
    column: COLUMN_RE.test(titles) ? -0.5 : 0,
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
}

export interface RankOptions {
  /** 기사 id → 브리핑 주요 기사 순위(1부터). 묶음 안 기사 중 가장 높은 순위를 쓴다. */
  cited?: ReadonlyMap<string, number>;
}

/**
 * 묶기 + 점수 + 정렬. 같은 입력이면 언제나 같은 순서 (결정적).
 * cited 가 있으면 브리핑에 실린 묶음이 먼저 (편집 검토를 거친 판단이므로), 그다음 점수 순.
 */
export function rankStories<T extends RankableArticle>(articles: T[], opts: RankOptions = {}): RankedStory<T>[] {
  const cited = opts.cited;
  const stories = dedupeReposts(articles).map((members) => {
    const primary = pickPrimary(members);
    const { score, detail } = scoreGroup(members);
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
      sources: [...new Set(members.map((m) => m.source_name).filter((x): x is string => !!x))],
      score,
      scoreDetail: detail,
      citedRank,
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
