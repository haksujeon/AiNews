/**
 * 후보 선정 (LLM 전, 결정적 처리) — 설계 검토서 §3.2.
 *
 *  1. 입력: 그날(베이징 news_date) PUBLIC_NEWS_WHERE 를 통과한 ai-* 기사 (DB 조회는 repository.ts)
 *  2. 정치 기사 제외 (재분류 오류로 ai-biz 에 들어온 정치·외교 기사)
 *  3. 전재 묶기: title_cn 이 같거나 한자 바이그램 Jaccard ≥ 0.6 이면 같은 글
 *  4. 묶음별 점수 → 상위 40개, 점수 순으로 A01.. 짧은 id
 *
 * 이 파일은 DB 를 import 하지 않는다 (단위 테스트가 DATABASE_URL 없이 돈다).
 */
import { createHash } from "node:crypto";
import type { CandidateArticle, CandidateGroup, EditionMode } from "./types";
import { findEntities, maxEntityTier } from "./entities";

export const REPOST_JACCARD = 0.6;
export const MAX_CANDIDATES = 40;

/** source_name 은 DB 에 영문으로 들어 있다 (36Kr, Huxiu, Qbitai, ITHome, Synced, XinZhiYuan) */
export const SOURCE_WEIGHT: Record<string, number> = {
  Qbitai: 1.0,
  Synced: 1.0,
  XinZhiYuan: 1.0,
  "36Kr": 0.8,
  ITHome: 0.7,
  Huxiu: 0.6,
};

const CATEGORY_WEIGHT: Record<string, number> = {
  "ai-tech": 1.0,
  "ai-product": 1.0,
  "ai-biz": 0.8,
};

const EVENT_RE = /모집|공모|참가자|신청 접수|대회 개최|행사|포럼|컨퍼런스|招募|报名|大赛|峰会|论坛|开幕/;
const COLUMN_RE = /칼럼|기고|인터뷰|대담|회고|에세이|专栏|对话|访谈|随笔/;
const POLITICS_RE = /총리|대통령|트럼프|외교부|국회|의회|선거|중의원|참의원|백악관|首相|总统|特朗普|外交部|白宫|议会|选举/;
const NUMBER_RE = /\d[\d,.]*\s?(?:%|억|만|위안|달러|명|개|배|MW|GW|B\b)/;

/** 공백·문장부호를 뺀 문자 바이그램 */
export function bigrams(s: string): Set<string> {
  const t = (s ?? "").replace(/[\s\p{P}\p{S}]+/gu, "");
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

/** 정치·외교 기사 판정: 정치 낱말이 있고, 제목에 AI 업계 실체가 없음 */
export function isPolitical(a: CandidateArticle): boolean {
  const text = `${a.title_kr} ${a.title_cn} ${a.summary_kr}`;
  if (!POLITICS_RE.test(text)) return false;
  return findEntities(`${a.title_kr} ${a.title_cn}`).length === 0;
}

/** 전재(같은 글) 묶기 — union-find. 반환: 묶음 배열 (각 묶음은 기사 배열) */
export function dedupeReposts(articles: CandidateArticle[], threshold = REPOST_JACCARD): CandidateArticle[][] {
  const parent = articles.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const grams = articles.map((a) => bigrams(a.title_cn));
  for (let i = 0; i < articles.length; i++) {
    for (let j = i + 1; j < articles.length; j++) {
      const same =
        (articles[i].title_cn && articles[i].title_cn.trim() === articles[j].title_cn?.trim()) ||
        jaccard(grams[i], grams[j]) >= threshold;
      if (same) parent[find(j)] = find(i);
    }
  }
  const groups = new Map<number, CandidateArticle[]>();
  articles.forEach((a, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(a);
  });
  return [...groups.values()];
}

export function scoreGroup(members: CandidateArticle[]): { score: number; detail: Record<string, number> } {
  const sources = new Set(members.map((m) => m.source_name));
  const text = members.map((m) => `${m.title_kr} ${m.title_cn} ${m.summary_kr}`).join(" ");
  const titles = members.map((m) => `${m.title_kr} ${m.title_cn}`).join(" ");
  const detail: Record<string, number> = {
    coverage: 3 * Math.log2(1 + sources.size),
    source: Math.max(...members.map((m) => SOURCE_WEIGHT[m.source_name] ?? 0.5)),
    category: Math.max(...members.map((m) => CATEGORY_WEIGHT[m.category] ?? 0.5)),
    company: maxEntityTier(text),
    number: NUMBER_RE.test(text) ? 0.5 : 0,
    event: EVENT_RE.test(titles) ? -1 : 0,
    column: COLUMN_RE.test(titles) ? -0.5 : 0,
  };
  const score = Object.values(detail).reduce((s, v) => s + v, 0);
  return { score: Math.round(score * 1000) / 1000, detail };
}

/** 대표 기사: 매체 가중이 높고 요약이 긴 쪽 */
function pickPrimary(members: CandidateArticle[]): CandidateArticle {
  return [...members].sort(
    (a, b) =>
      (SOURCE_WEIGHT[b.source_name] ?? 0) - (SOURCE_WEIGHT[a.source_name] ?? 0) ||
      (b.summary_kr?.length ?? 0) - (a.summary_kr?.length ?? 0) ||
      a.id.localeCompare(b.id)
  )[0];
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
  const raw = dedupeReposts(kept).map((members) => {
    const primary = pickPrimary(members);
    const { score, detail } = scoreGroup(members);
    return {
      shortId: "",
      primary,
      siblings: members.filter((m) => m.id !== primary.id),
      sources: [...new Set(members.map((m) => m.source_name))],
      score,
      scoreDetail: detail,
    } satisfies CandidateGroup;
  });
  raw.sort((a, b) => b.score - a.score || a.primary.id.localeCompare(b.primary.id));
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
