/**
 * 후보 선정 (LLM 전, 결정적 처리) — 설계 검토서 §3.2.
 *
 *  1. 입력: 그날(베이징 news_date) PUBLIC_NEWS_WHERE 를 통과한 ai-* 기사 (DB 조회는 repository.ts)
 *  2. 정치 기사 제외 (재분류 오류로 ai-biz 에 들어온 정치·외교 기사)
 *  3. 전재 묶기: title_cn 이 같거나 한자 바이그램 Jaccard ≥ 0.6 이면 같은 글
 *  4. 묶음별 점수 → 상위 40개, 점수 순으로 A01.. 짧은 id
 *  (3·4 는 홈 목록과 공유하는 src/lib/news-rank.ts 의 rankStories)
 *
 * 이 파일은 DB 를 import 하지 않는다 (단위 테스트가 DATABASE_URL 없이 돈다).
 */
import { createHash } from "node:crypto";
import type { CandidateArticle, CandidateGroup, EditionMode } from "./types";
import { findEntities } from "./entities";
import { rankStories, sameEvent } from "../news-rank";

// 묶기·점수 공식은 홈 목록 "주요 4건"과 공유한다 (src/lib/news-rank.ts). 여기서 다시 쓰지 말 것.
// 같은 사건 판정(sameEvent)도 news-rank.ts 로 옮겼다 — 데일리·홈 점수(사건 단위 매체 수)와 주간·월간 2단계 묶기가 같은 함수.
export {
  REPOST_JACCARD,
  SOURCE_WEIGHT,
  bigrams,
  jaccard,
  dedupeReposts,
  scoreGroup,
  sameEvent,
  productTokens,
  EVENT_TITLE_JACCARD,
  EVENT_MAX_DAY_GAP,
} from "../news-rank";

export const MAX_CANDIDATES = 40;

const POLITICS_RE = /총리|대통령|트럼프|외교부|국회|의회|선거|중의원|참의원|백악관|首相|总统|特朗普|外交部|白宫|议会|选举/;

/** 정치·외교 기사 판정: 정치 낱말이 있고, 제목에 AI 업계 실체가 없음 */
export function isPolitical(a: CandidateArticle): boolean {
  const text = `${a.title_kr} ${a.title_cn} ${a.summary_kr}`;
  if (!POLITICS_RE.test(text)) return false;
  return findEntities(`${a.title_kr} ${a.title_cn}`).length === 0;
}

export interface SelectionResult {
  groups: CandidateGroup[]; // 상위 MAX_CANDIDATES, 점수 순, A01..
  totalGroups: number; // 정치 제외·전재 묶음 후 전체 묶음 수 (물량 판정 기준)
  publicArticleCount: number; // 입력 기사 수
  politicalExcluded: string[]; // uuid
}

export function selectCandidates(articles: CandidateArticle[], max = MAX_CANDIDATES): SelectionResult {
  const politicalExcluded = articles.filter(isPolitical).map((a) => a.id);
  const kept = articles.filter((a) => !politicalExcluded.includes(a.id));
  // 브리핑 후보는 cited 없이 점수 순 (rankStories 의 정렬 = 점수 내림차순 → 대표 id)
  const raw = rankStories(kept).map(
    (st) =>
      ({
        shortId: "",
        primary: st.primary,
        siblings: st.siblings,
        sources: st.sources,
        eventSources: st.eventSources,
        score: st.score,
        scoreDetail: st.scoreDetail,
      }) satisfies CandidateGroup
  );
  const groups = raw.slice(0, max).map((g, i) => ({ ...g, shortId: `A${String(i + 1).padStart(2, "0")}` }));
  return { groups, totalGroups: raw.length, publicArticleCount: articles.length, politicalExcluded };
}

/** §1.2 물량 규칙 */
export function editionModeFor(groupCount: number): EditionMode {
  if (groupCount >= 6) return "normal";
  if (groupCount >= 3) return "short";
  return "skipped";
}

/**
 * 입력 해시 — 후보 id·본문 지문·프롬프트 버전·모델.
 * ai_news_ex 에 updated_at 이 없어 본문 지문으로 "같은 입력" 을 판정한다.
 */
export function computeInputHash(groups: CandidateGroup[], promptVersion: string, model: string): string {
  const fp = (a: CandidateArticle) =>
    createHash("sha256")
      .update([a.title_kr, a.title_cn, a.summary_kr, a.ai_insights_kr, a.category].join("\u0001"))
      .digest("hex")
      .slice(0, 16);
  const rows = groups
    .flatMap((g) => [g.primary, ...g.siblings])
    .map((a) => `${a.id}:${fp(a)}`)
    .sort();
  return createHash("sha256")
    .update(JSON.stringify({ promptVersion, model, rows }))
    .digest("hex");
}

// ───────────────────────── 기간(주간·월간) 이야기 묶기 — 2단계
//
// 1단계(전재 묶기, rankStories)는 같은 글만 묶어 정밀하지만, 같은 사건을 다른 글로 쓴 기사
// ("Gemini 4 Carbon 발표" 와 "Gemini 4 Carbon 지능 지수 1위")는 갈라진다.
// 2단계: 같은 실체 + (같은 영문 제품 토큰 또는 한국어 제목 바이그램 Jaccard ≥ 0.3) + 날짜 차이 ±2일 이내면 같은 사건
// (판정 sameEvent 는 news-rank.ts).

/** 2단계 묶기 입력: 1단계 묶음 하나 */
export interface PeriodStoryInput {
  ids: string[];
  primary_id: string;
  title_kr: string;
  title_cn: string;
  sources: string[];
  days: string[]; // YYYY-MM-DD 오름차순
  entities: string[]; // 실체 key
  score: number;
}

export interface PeriodEvent<T extends PeriodStoryInput = PeriodStoryInput> {
  /** 점수가 가장 높은 1단계 묶음 */
  lead: T;
  members: T[];
  ids: string[];
  sources: string[];
  days: string[];
}

/** 1단계 묶음들 → 사건 (union-find). 반환 순서: 매체 수 내림차순 → 점수 내림차순 → 대표 id */
export function groupPeriodStories<T extends PeriodStoryInput>(stories: T[]): PeriodEvent<T>[] {
  const parent = stories.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < stories.length; i++)
    for (let j = i + 1; j < stories.length; j++) if (sameEvent(stories[i], stories[j])) parent[find(j)] = find(i);
  const byRoot = new Map<number, T[]>();
  stories.forEach((s, i) => {
    const r = find(i);
    if (!byRoot.has(r)) byRoot.set(r, []);
    byRoot.get(r)!.push(s);
  });
  const events = [...byRoot.values()].map((members) => {
    const lead = [...members].sort((a, b) => b.score - a.score || a.primary_id.localeCompare(b.primary_id))[0];
    return {
      lead,
      members,
      ids: [...new Set(members.flatMap((m) => m.ids))],
      sources: [...new Set(members.flatMap((m) => m.sources))],
      days: [...new Set(members.flatMap((m) => m.days))].sort(),
    } satisfies PeriodEvent<T>;
  });
  return events.sort(
    (a, b) => b.sources.length - a.sources.length || b.lead.score - a.lead.score || a.lead.primary_id.localeCompare(b.lead.primary_id)
  );
}
