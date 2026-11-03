/**
 * "쉬운 AI 설명" 자동 생성 (2026-11-03 확산 — 사용자 "1번 진행").
 * 데일리 판이 발행되면 그 판의 주요 기사 용어 상자를 만든다. 부르는 곳은 셋이고 모두 이 함수 하나를 쓴다 (Gate 2):
 *  - 관리자 발행 (api/admin/briefing/publish)
 *  - AI 검토 자동 발행 직후 (review/pipeline.ts, 시간이 남을 때)
 *  - AI 검토 스윕 끝 (같은 파일 — 발행 직후에 시간이 모자랐던 판을 따라잡기)
 *  - CLI scripts/briefing-easy-terms.ts
 *
 * 규칙:
 *  - 이미 용어가 저장된 기사는 다시 만들지 않는다 (사람이 고친 행을 덮어쓰지 않는다. 재발행으로 판 버전만 바뀐 경우도 그대로).
 *  - 발행 ko 판 하나당 한 번만 시도하고 briefing_easy_runs 에 남긴다 (오류는 남기지 않아 다음 스윕이 다시 한다). 상자가 안 나온 기사(통과 용어 < 2)를 스윕마다 다시 부르지 않는다.
 *    CLI --force 만 기록을 무시한다.
 *  - 끄기: BRIEFING_EASY_TERMS=off
 *  - 별도 AI 검토는 하지 않는다. 코드 검사(easy-terms.ts checkEasyTerms)만 통과하면 저장한다.
 */
import type { KeyTerm, StoredBriefingContent } from "./types";
import {
  checkEasyTerms,
  EASY_TERMS_MODEL,
  EASY_TERMS_SYSTEM,
  easyTermsUserPrompt,
  storyInputs,
  type EasyCheckProblem,
  type StoryInput,
} from "./easy-terms";

/** LLM 1회 시간 한도. AI 검토 라우트(300초) 안에서 부르므로 pipeline.ts 가 이만큼 남았을 때만 부른다 */
export const EASY_TIMEOUT_MS = 75_000;

export interface EasyRunResult {
  date: string | null;
  briefingId: string | null;
  /** skipped: 끔·발행본 없음·이미 시도함 / none: 만들 기사 없음(LLM 안 부름) / generated: 저장함 / error */
  status: "skipped" | "none" | "generated" | "error";
  detail: string;
  stories: number;
  saved: number;
  problems: EasyCheckProblem[];
  costUsd: number;
}

export interface EasyRunDeps {
  loadPublished: (date?: string) => Promise<{ id: string; date: string; content: StoredBriefingContent } | null>;
  hasRun: (briefingId: string) => Promise<boolean>;
  keyTerms: (articleIds: string[]) => Promise<Map<string, KeyTerm[]>>;
  /** 이미 ko 용어가 저장된 기사 id */
  existing: (articleIds: string[]) => Promise<Set<string>>;
  generate: (stories: StoryInput[]) => Promise<{ raw: unknown; costUsd: number }>;
  save: (date: string, byArticle: ReturnType<typeof checkEasyTerms>["byArticle"], costUsd: number) => Promise<number>;
  recordRun: (briefingId: string, date: string, result: EasyRunResult) => Promise<void>;
}

/** 아직 용어가 없는 기사만 (순수). 근거 기사 키로 붙이므로 primary_ref 만 본다 */
export function missingStories(stories: StoryInput[], existing: Set<string>): StoryInput[] {
  return stories.filter((s) => !existing.has(s.articleId));
}

export function easyTermsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.BRIEFING_EASY_TERMS ?? "on").toLowerCase() !== "off";
}

/** 한 줄 요약 (텔레그램·API 응답) */
export function easyRunNote(r: EasyRunResult): string {
  if (r.status === "generated") return `쉬운 AI 설명 ${r.saved / 3}건${r.problems.length ? ` (검사에서 뺀 것 ${r.problems.length})` : ""}`;
  if (r.status === "error") return `쉬운 AI 설명 실패: ${r.detail}`;
  return "";
}

export async function ensureEasyTerms(
  opts: { date?: string; force?: boolean; dry?: boolean } = {},
  deps?: EasyRunDeps
): Promise<EasyRunResult & { byArticle?: ReturnType<typeof checkEasyTerms>["byArticle"]; inputs?: StoryInput[] }> {
  const base = { date: opts.date ?? null, briefingId: null, stories: 0, saved: 0, problems: [], costUsd: 0 };
  if (!easyTermsEnabled()) return { ...base, status: "skipped", detail: "BRIEFING_EASY_TERMS=off" };
  const d = deps ?? (await dbDeps());
  const ed = await d.loadPublished(opts.date);
  if (!ed) return { ...base, status: "skipped", detail: "발행된 ko 데일리 판 없음" };
  const head = { ...base, date: ed.date, briefingId: ed.id };
  if (!opts.force && (await d.hasRun(ed.id))) return { ...head, status: "skipped", detail: "이 판은 이미 시도함" };

  let result: EasyRunResult;
  let byArticle: ReturnType<typeof checkEasyTerms>["byArticle"] | undefined;
  let inputs: StoryInput[] = [];
  try {
    const refs = [...new Set(ed.content.top_stories.flatMap((s) => s.refs))];
    const all = storyInputs(ed.content, await d.keyTerms(refs));
    inputs = missingStories(all, await d.existing(all.map((s) => s.articleId)));
    if (!inputs.length) {
      result = { ...head, status: "none", detail: `만들 기사 없음 (후보 2개 이상 ${all.length}건, 모두 저장돼 있음)`, stories: 0 };
    } else {
      const g = await d.generate(inputs);
      const checked = checkEasyTerms(inputs, g.raw);
      byArticle = checked.byArticle;
      const saved = opts.dry ? 0 : await d.save(ed.date, checked.byArticle, g.costUsd);
      result = {
        ...head, status: "generated", detail: `${inputs.length}건 중 ${checked.byArticle.size}건 상자${opts.dry ? " (dry: 저장 안 함)" : ""}`,
        stories: inputs.length, saved, problems: checked.problems, costUsd: Math.round(g.costUsd * 1e6) / 1e6,
      };
    }
  } catch (e) {
    result = { ...head, status: "error", detail: (e as Error).message.slice(0, 300), stories: inputs.length };
  }
  // 오류(LLM 시간 초과 등)는 기록하지 않는다 → 다음 스윕이 다시 시도 (하루 몇 번뿐)
  if (!opts.dry && result.status !== "error") await d.recordRun(ed.id, ed.date, result).catch((e) => console.error("[easy-terms] 기록 실패", (e as Error).message));
  return { ...result, byArticle, inputs };
}

async function dbDeps(): Promise<EasyRunDeps> {
  const pool = (await import("@/lib/db")).default;
  const { chat, parseJsonContent } = await import("./llm");
  const { saveEasyTerms } = await import("./easy-terms-store");
  return {
    loadPublished: async (date) => {
      const { rows } = await pool.query(
        `SELECT id::text AS id, to_char(edition_date, 'YYYY-MM-DD') AS date, content FROM daily_briefings
          WHERE status = 'published' AND edition_type = 'daily' AND locale = 'ko' AND ($1::date IS NULL OR edition_date = $1::date)
          ORDER BY edition_date DESC LIMIT 1`,
        [date ?? null]
      );
      const r = rows[0];
      return r && Array.isArray(r.content?.top_stories) ? { id: r.id, date: r.date, content: r.content } : null;
    },
    hasRun: async (id) => (await pool.query(`SELECT 1 FROM briefing_easy_runs WHERE briefing_id = $1::uuid`, [id])).rows.length > 0,
    keyTerms: async (ids) => {
      const { rows } = await pool.query(`SELECT id::text AS id, key_terms FROM ai_news_ex WHERE id = ANY($1::uuid[])`, [ids]);
      return new Map(rows.map((a: { id: string; key_terms: unknown }) => [a.id, Array.isArray(a.key_terms) ? (a.key_terms as KeyTerm[]) : []]));
    },
    existing: async (ids) => {
      const { rows } = await pool.query(`SELECT article_id::text AS id FROM briefing_easy_terms WHERE article_id = ANY($1::uuid[]) AND locale = 'ko'`, [ids]);
      return new Set(rows.map((r: { id: string }) => r.id));
    },
    generate: async (stories) => {
      let cost = 0;
      const res = await chat(
        { model: EASY_TERMS_MODEL, effort: "low", system: EASY_TERMS_SYSTEM, messages: [{ role: "user", content: easyTermsUserPrompt(stories) }], maxTokens: 6000, timeoutMs: EASY_TIMEOUT_MS },
        (u) => (cost += u.costUsd)
      );
      return { raw: parseJsonContent(res.content), costUsd: cost };
    },
    save: (date, byArticle, cost) => saveEasyTerms(date, byArticle, EASY_TERMS_MODEL, cost),
    recordRun: async (id, date, r) => {
      await pool.query(
        `INSERT INTO briefing_easy_runs (briefing_id, edition_date, result, cost_usd) VALUES ($1::uuid, $2::date, $3::jsonb, $4)
         ON CONFLICT (briefing_id) DO UPDATE SET result = EXCLUDED.result, cost_usd = EXCLUDED.cost_usd, created_at = now()`,
        [id, date, JSON.stringify({ status: r.status, detail: r.detail, stories: r.stories, saved: r.saved, problems: r.problems }), r.costUsd]
      );
    },
  };
}
