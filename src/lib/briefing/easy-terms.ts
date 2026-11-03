/**
 * "쉬운 AI 설명" (2026-11-03 시범) — 데일리 브리핑 주요 기사마다 어려운 AI 용어 2~3개를 초등 고학년 눈높이의 한 줄로 푼다.
 * ~/ainews-reports/easy-explain-2026-11/PROPOSAL.md 의 용어 부분만 먼저. 판 본문(content)에는 쓰지 않고 briefing_easy_terms 에 따로 둔다.
 *
 * 흐름: 주요 기사의 근거 기사 key_terms → 후보(기업·제품 이름 빼고, 앞 순위 기사에 먼저) → Sonnet 1회(3개 언어 동시)
 *       → 코드 검사(후보에 있는 용어만·숫자 없음·ko/en 에 한자 없음·기업 이름 없음·길이) → 2개 미만이면 그 기사는 상자 없음.
 * term·pinyin·detail(자세히)은 DB key_terms 를 그대로 복사한다. 모델이 쓰는 것은 name(그 언어 이름)과 easy(쉬운 한 줄)뿐.
 */
import type { EasyTerm, KeyTerm, StoredBriefingContent } from "./types";

export type { EasyTerm };
import { findEntities, PRODUCT_NAMES } from "./entities";
import { hasHan } from "../text/han";

export const EASY_TERMS_PROMPT_VERSION = "easy-terms-v1";
export const EASY_TERMS_MODEL = process.env.EASY_TERMS_MODEL || "anthropic-api-sonnet-5-5";
export const EASY_LOCALES = ["ko", "en", "zh"] as const;
export type EasyLocale = (typeof EASY_LOCALES)[number];
export const MIN_TERMS = 2;
export const MAX_TERMS = 3;
const MAX_CANDIDATES = 8;

export interface Candidate {
  term: string;
  pinyin: string;
  detail: Record<EasyLocale, string>;
}

export interface StoryInput {
  /** 저장 키 = 주요 기사의 primary_ref */
  articleId: string;
  rank: number;
  title: string;
  what: string;
  why: string;
  candidates: Candidate[];
}

const isBrandName = (term: string) =>
  findEntities(term).length > 0 || PRODUCT_NAMES.some((p) => [...p.ko, ...p.en, ...p.zh].some((n) => term.includes(n)));

/**
 * 주요 기사별 후보 용어 (순수). 근거 기사 key_terms 를 합치고, 기업·제품 이름과 설명 없는 용어는 빼고,
 * 같은 용어는 앞 순위 기사에만 둔다.
 */
export function buildCandidates(
  stories: { rank: number; refs: string[] }[],
  keyTerms: Map<string, KeyTerm[]>
): Map<number, Candidate[]> {
  const seen = new Set<string>();
  const out = new Map<number, Candidate[]>();
  for (const s of [...stories].sort((a, b) => a.rank - b.rank)) {
    const list: Candidate[] = [];
    for (const ref of s.refs)
      for (const k of keyTerms.get(ref) ?? []) {
        const term = (k.term ?? "").trim();
        if (!term || seen.has(term) || isBrandName(term)) continue;
        const detail = { ko: (k.explanation_kr ?? "").trim(), en: (k.explanation_en ?? "").trim(), zh: (k.explanation_zh ?? "").trim() };
        if (!detail.ko || !detail.en || !detail.zh) continue;
        seen.add(term);
        list.push({ term, pinyin: (k.pinyin ?? "").trim(), detail });
      }
    out.set(s.rank, list.slice(0, MAX_CANDIDATES));
  }
  return out;
}

/** 판(ko) + key_terms → 모델 입력 (순수) */
export function storyInputs(content: StoredBriefingContent, keyTerms: Map<string, KeyTerm[]>): StoryInput[] {
  const cands = buildCandidates(content.top_stories, keyTerms);
  return content.top_stories
    .map((s) => ({ articleId: s.primary_ref, rank: s.rank, title: s.title, what: s.what, why: s.why, candidates: cands.get(s.rank) ?? [] }))
    .filter((s) => s.articleId && s.candidates.length >= MIN_TERMS);
}

export const EASY_TERMS_SYSTEM = `당신은 어린이 과학 잡지 기자입니다. AI 뉴스에 나오는 어려운 용어를 초등학교 5~6학년이 이해할 수 있게 한 줄로 풉니다.

규칙:
1. 기사마다 CANDIDATES 중에서 일반 독자가 가장 어려워할 AI·기술 용어 ${MIN_TERMS}~${MAX_TERMS}개를 고릅니다. 마케팅·조직·유행어(예: 种草, 一级部门)와 회사·제품 이름은 고르지 않습니다. 고를 용어가 ${MIN_TERMS}개가 안 되면 그 기사는 비워 둡니다.
2. "term" 은 CANDIDATES 의 TERM 값만 한 글자도 바꾸지 말고 그대로 씁니다(병음·괄호를 붙이지 않음).
3. "name" 은 그 언어의 흔한 이름입니다. 한국어는 기사 TITLE/WHAT/WHY 에 그 말이 나오면 그 표기를 그대로 씁니다(예: 에이전트, 추론). 한국어·영어 name 에는 한자를 쓰지 않습니다. 중국어 name 은 원어 그대로 써도 됩니다.
4. "easy" 는 한 문장입니다. 한국어 25~70자, 영어 12~28단어, 중국어 15~45자. 쉬운 낱말만 쓰고, 비유는 하나까지(학교·집·놀이처럼 아이가 아는 것). 다른 전문 용어(토큰·파라미터·연산 등)로 설명하지 않습니다.
5. 뜻은 DETAIL 설명에만 근거합니다. 새 사실·숫자·회사 이름·기사 내용 평가를 넣지 않습니다. 숫자(아라비아 숫자)는 쓰지 않습니다.
6. 세 언어는 같은 뜻이어야 합니다.

JSON 하나만 출력합니다:
{"stories":[{"id":"S1","terms":[{"term":"원어","name":{"ko":"","en":"","zh":""},"easy":{"ko":"","en":"","zh":""}}]}]}`;

export function easyTermsUserPrompt(stories: StoryInput[]): string {
  return stories
    .map(
      (s, i) =>
        `[S${i + 1}]\nTITLE: ${s.title}\nWHAT: ${s.what}\nWHY: ${s.why}\nCANDIDATES:\n${s.candidates
          .map((c) => `- TERM: ${c.term} | PINYIN: ${c.pinyin} | DETAIL: ${c.detail.ko}`)
          .join("\n")}`
    )
    .join("\n\n");
}

export interface EasyCheckProblem {
  story: string;
  term?: string;
  reason: string;
}

const LEN: Record<EasyLocale, [number, number]> = { ko: [15, 90], en: [40, 220], zh: [10, 60] };
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * 모델 출력 검사 (순수). 통과한 용어만 언어별로 돌려준다. 기사 하나에 통과 용어가 MIN_TERMS 개 미만이면 그 기사는 뺀다.
 */
export function checkEasyTerms(
  stories: StoryInput[],
  raw: unknown
): { byArticle: Map<string, Record<EasyLocale, EasyTerm[]>>; problems: EasyCheckProblem[] } {
  const problems: EasyCheckProblem[] = [];
  const byArticle = new Map<string, Record<EasyLocale, EasyTerm[]>>();
  const list = Array.isArray((raw as { stories?: unknown })?.stories) ? ((raw as { stories: unknown[] }).stories as Record<string, unknown>[]) : [];
  for (const [i, s] of stories.entries()) {
    const id = `S${i + 1}`;
    const out = list.find((o) => str(o?.id) === id);
    const terms = Array.isArray(out?.terms) ? (out!.terms as Record<string, unknown>[]) : [];
    const ok: Record<EasyLocale, EasyTerm[]> = { ko: [], en: [], zh: [] };
    const used = new Set<string>();
    for (const t of terms) {
      if (ok.ko.length >= MAX_TERMS) break;
      // 모델이 "原文 (pinyin)" 처럼 병음을 붙여 돌려주면 괄호를 떼고 다시 찾는다 (후보 글자 그대로여야 하는 규칙은 같다)
      const rawTerm = str(t?.term);
      const term = s.candidates.some((c) => c.term === rawTerm) ? rawTerm : rawTerm.replace(/\s*[(（][^)）]*[)）]\s*$/, "");
      const cand = s.candidates.find((c) => c.term === term);
      const bad = (reason: string) => problems.push({ story: id, term, reason });
      if (!cand) {
        bad("후보에 없는 용어");
        continue;
      }
      if (used.has(term)) continue;
      const name = (t.name ?? {}) as Record<string, unknown>;
      const easy = (t.easy ?? {}) as Record<string, unknown>;
      let fail = "";
      for (const l of EASY_LOCALES) {
        const n = str(name[l]);
        const e = str(easy[l]);
        if (!n || !e) fail ||= `${l} 비어 있음`;
        else if (/\d/.test(e) || /\d/.test(n)) fail ||= `${l} 숫자`;
        else if (l !== "zh" && (hasHan(e) || hasHan(n))) fail ||= `${l} 한자`;
        else if (findEntities(e).length) fail ||= `${l} 기업 이름`;
        else if (e.length < LEN[l][0] || e.length > LEN[l][1]) fail ||= `${l} 길이 ${e.length}`;
      }
      if (fail) {
        bad(fail);
        continue;
      }
      used.add(term);
      for (const l of EASY_LOCALES) {
        const n = str(name[l]);
        // 영어 이름은 첫 글자만 대문자로 맞춘다 (모델이 "watchdog"·"Pareto frontier" 를 섞어 쓴다)
        ok[l].push({ term, pinyin: cand.pinyin, name: l === "en" ? n.charAt(0).toUpperCase() + n.slice(1) : n, easy: str(easy[l]), detail: cand.detail[l] });
      }
    }
    if (ok.ko.length >= MIN_TERMS) byArticle.set(s.articleId, ok);
    else problems.push({ story: id, reason: `통과 용어 ${ok.ko.length}개 (< ${MIN_TERMS}) — 상자 없음` });
  }
  return { byArticle, problems };
}

/** 화면용: 판의 주요 기사에 그 언어 용어를 붙인다 (순수). 근거 기사 중 하나라도 키가 맞으면 붙인다(숨김으로 primary_ref 가 바뀌어도). */
export function attachEasyTerms<T extends { refs: string[]; primary_ref: string }>(
  stories: T[],
  rows: Map<string, EasyTerm[]>
): (T & { easy_terms?: EasyTerm[] })[] {
  return stories.map((s) => {
    const key = [s.primary_ref, ...s.refs].find((r) => rows.has(r));
    return key ? { ...s, easy_terms: rows.get(key) } : s;
  });
}
