/**
 * "회사·관련 주제 히스토리 분석" 자동 생성 (2026-11-04 사용자 결정: 메일 요약형 + 매일 자동 생성 + 화면 개편 같이 반영).
 * 발행된 ko 데일리 판의 주요 기사마다 회사·관련 주제 두 관점 → 코드 검사 → ko 저장 → zh·en 번역·검사 → 저장.
 * 사이트 상자(public.ts hydrate)와 구독자 메일이 같은 행을 읽는다.
 *
 * 부르는 곳: CLI scripts/briefing-story-context.ts (cron 02:40·04:00·05:30 KST — 판 발행 약 01:30 뒤, 메일 07:00 전, 수집 시간 밖).
 *  LLM 을 20번 안팎 부르므로(몇 분) 관리자 발행·AI 검토 라우트(300초) 안에서는 부르지 않는다.
 *
 * 규칙 (easy-terms-run.ts 와 같은 모양):
 *  - 이미 그 관점·언어 행이 있으면 다시 만들지 않는다 (11-03 시범 행·사람이 고친 행을 덮어쓰지 않는다. 저장은 ON CONFLICT DO NOTHING).
 *  - ko 판 하나당 끝까지 간 시도를 briefing_story_runs 에 남긴다. LLM 오류가 하나라도 있으면 남기지 않아 다음 실행이 빠진 것만 다시 한다.
 *  - 검사에 걸린 관점은 저장하지 않는다(상자에서 빠질 뿐). 끄기: BRIEFING_STORY_CONTEXT=off
 */
import type { StoredBriefingContent } from "./types";
import {
  PLAN_SYSTEM,
  SELECT_SYSTEM,
  STORY_LOOKBACK_DAYS,
  STORY_MAX_CANDIDATES,
  STORY_MODEL,
  STORY_PROMPT_VERSION,
  SYNTH_SYSTEM,
  buildLensPlans,
  checkStory,
  checkTranslated,
  pickedFrom,
  planUserPrompt,
  selectUserPrompt,
  synthUserPrompt,
  toKoRow,
  toLocaleRow,
  translatable,
  translateSystem,
  translateUserPrompt,
  type Candidate,
  type Lens,
  type LensPlan,
  type StoryRow,
  type SynthOut,
  type TranslatableLens,
} from "./story-gen";

export interface StoryRunResult {
  date: string | null;
  briefingId: string | null;
  status: "skipped" | "done" | "error";
  detail: string;
  /** 새로 저장한 행 (언어별) */
  saved: { ko: number; zh: number; en: number };
  problems: string[];
  errors: string[];
  costUsd: number;
}

export interface LlmCall {
  model?: string;
  effort?: "low" | "medium";
  system: string;
  user: string;
  maxTokens?: number;
}

export interface StoryRunDeps {
  loadPublished: (date?: string) => Promise<{ id: string; date: string; content: StoredBriefingContent } | null>;
  hasRun: (briefingId: string) => Promise<boolean>;
  /** (article_id, lens, locale) 키 "id:lens:locale" */
  existing: (articleIds: string[]) => Promise<Set<string>>;
  todayArticles: (ids: string[]) => Promise<{ id: string; title_kr: string; summary_kr: string | null; title_cn: string }[]>;
  candidates: (plan: LensPlan, edition: string, excludeIds: string[]) => Promise<Candidate[]>;
  koRows: (articleIds: string[]) => Promise<StoryRow[]>;
  titles: (ids: string[]) => Promise<Map<string, { title_kr: string; title_cn: string; title_en: string | null }>>;
  llm: (c: LlmCall) => Promise<{ raw: unknown; costUsd: number }>;
  translateLlm: (c: LlmCall, fallback: boolean) => Promise<{ raw: unknown; costUsd: number } | null>;
  save: (rows: StoryRow[], edition: string, model: string, costEach: number) => Promise<number>;
  recordRun: (briefingId: string, date: string, r: StoryRunResult) => Promise<void>;
}

export function storyContextEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return (env.BRIEFING_STORY_CONTEXT ?? "on").toLowerCase() !== "off";
}

const LENSES: Lens[] = ["company", "topic"];
const TARGETS = ["zh", "en"] as const;
const key = (id: string, lens: Lens, locale: string) => `${id}:${lens}:${locale}`;

export async function ensureStoryContext(
  opts: { date?: string; force?: boolean; dry?: boolean; log?: (s: string) => void } = {},
  deps?: StoryRunDeps
): Promise<StoryRunResult & { rows?: StoryRow[] }> {
  const log = opts.log ?? (() => {});
  const res: StoryRunResult = { date: opts.date ?? null, briefingId: null, status: "skipped", detail: "", saved: { ko: 0, zh: 0, en: 0 }, problems: [], errors: [], costUsd: 0 };
  if (!storyContextEnabled()) return { ...res, detail: "BRIEFING_STORY_CONTEXT=off" };
  const d = deps ?? (await dbDeps());
  const ed = await d.loadPublished(opts.date);
  if (!ed) return { ...res, detail: "발행된 ko 데일리 판 없음" };
  res.date = ed.date;
  res.briefingId = ed.id;
  if (!opts.force && (await d.hasRun(ed.id))) return { ...res, detail: "이 판은 이미 끝까지 시도함" };

  let cost = 0;
  const call = async (c: LlmCall) => {
    const r = await d.llm(c);
    cost += r.costUsd;
    return r.raw;
  };
  const stories = ed.content.top_stories.filter((s) => s.primary_ref);
  const ids = stories.map((s) => s.primary_ref!);
  const have = await d.existing(ids);
  const newRows: StoryRow[] = [];

  // ── 1) ko 만들기 (기사마다, 없는 관점만)
  for (const s of stories) {
    const id = s.primary_ref!;
    const missing = LENSES.filter((l) => !have.has(key(id, l, "ko")));
    if (!missing.length) continue;
    const tag = `#${s.rank}`;
    try {
      const today = await d.todayArticles(s.refs);
      const todayTxt = `제목: ${s.title}\n무슨 일: ${s.what ?? ""}\n${today.map((t) => `- ${t.title_kr}: ${t.summary_kr ?? ""}`).join("\n")}`;
      const planRaw = await call({ effort: "low", system: PLAN_SYSTEM, user: planUserPrompt({ title: s.title, subject: s.subject ?? "", what: s.what ?? "", articles: today }), maxTokens: 2000 });
      const plans = buildLensPlans(planRaw, { title: s.title, subject: s.subject ?? "" }).filter((p) => missing.includes(p.lens));
      for (const l of missing) if (!plans.some((p) => p.lens === l)) res.problems.push(`${tag} ${l}: 검색어 부족`);
      for (const plan of plans) {
        const pool = await d.candidates(plan, ed.date, s.refs);
        if (pool.length < 2) {
          res.problems.push(`${tag} ${plan.lens}: 후보 ${pool.length}건`);
          continue;
        }
        const sel = pickedFrom(await call({ effort: "low", system: SELECT_SYSTEM, user: selectUserPrompt(plan, todayTxt, pool), maxTokens: 3000 }), pool);
        if (sel.picked.length < 2) {
          res.problems.push(`${tag} ${plan.lens}: 고른 기사 ${sel.picked.length}건`);
          continue;
        }
        const out = (await call({ effort: "medium", system: SYNTH_SYSTEM, user: synthUserPrompt(ed.date, todayTxt, sel.picked), maxTokens: 4000 })) as SynthOut;
        if (!out || out.skip) {
          res.problems.push(`${tag} ${plan.lens}: 엮을 것 없음`);
          continue;
        }
        const probs = checkStory(out, sel.picked);
        if (probs.length) {
          res.problems.push(`${tag} ${plan.lens}: ${probs.join(" / ")}`);
          continue;
        }
        newRows.push(toKoRow(id, plan.lens, sel.threadTitle || plan.topicName || s.subject || s.title, out, sel.picked));
        log(`${tag} ${plan.lens} 후보 ${pool.length} → 고름 ${sel.picked.length} → 통과`);
      }
    } catch (e) {
      res.errors.push(`${tag}: ${(e as Error).message.slice(0, 200)}`);
    }
  }
  const koCost = cost;
  if (!opts.dry && newRows.length) res.saved.ko = await d.save(newRows, ed.date, STORY_MODEL, koCost / newRows.length);

  // ── 2) zh·en 옮기기 (ko 행이 있고 그 언어 행이 없는 관점 — 오늘 만든 것 + 이전에 있던 것)
  const koAll = opts.dry ? newRows : await d.koRows(ids);
  const refIds = [...new Set(koAll.flatMap((r) => r.timeline.flatMap((t) => t.refs.map((x) => x.id))))];
  const titles = refIds.length ? await d.titles(refIds) : new Map();
  const out: StoryRow[] = [...newRows];
  for (const target of TARGETS) {
    const todo = koAll.filter((r) => !have.has(key(r.article_id, r.lens, target)));
    if (!todo.length) continue;
    const src: TranslatableLens[] = todo.map(translatable);
    const before = cost;
    try {
      const done = new Map<number, TranslatableLens>();
      let issues: string[] = [];
      /** 원래 순번 → 마지막 검사에서 걸린 첫 문제 (기록용) */
      const lastIssues: Record<number, string> = {};
      for (const fallback of [false, true]) {
        const rest = src.map((x, i) => ({ x, i })).filter(({ i }) => !done.has(i));
        if (!rest.length) break;
        const r = await d.translateLlm({ system: translateSystem(target), user: translateUserPrompt(rest.map((z) => z.x), fallback ? issues : undefined), maxTokens: 8000 }, fallback);
        if (!r) break;
        cost += r.costUsd;
        const chk = checkTranslated(rest.map((z) => z.x), r.raw, target);
        for (const [k, v] of chk.ok) done.set(rest[k].i, v);
        // 다음 호출은 실패한 항목만 0번부터 다시 번호를 매긴다 → 문제 목록의 번호도 맞춘다
        const failed = rest.map((_, k) => k).filter((k) => !chk.ok.has(k));
        for (const m of chk.issues) {
          const k = Number(/^item (\d+)/.exec(m)?.[1]);
          if (Number.isInteger(k) && rest[k]) lastIssues[rest[k].i] ??= m.replace(/^item \d+ /, "");
        }
        issues = chk.issues.map((m) => m.replace(/^item (\d+)/, (_, n) => `item ${failed.indexOf(Number(n))}`));
      }
      const rows = [...done].map(([i, v]) => toLocaleRow(todo[i], v, target, titles));
      for (let i = 0; i < todo.length; i++) if (!done.has(i)) res.problems.push(`${target} ${todo[i].lens} ${todo[i].article_id.slice(0, 8)}: 번역 검사 실패 (${lastIssues[i] ?? "?"})`);
      out.push(...rows);
      if (!opts.dry && rows.length) res.saved[target] = await d.save(rows, ed.date, "translate", (cost - before) / rows.length);
    } catch (e) {
      res.errors.push(`${target}: ${(e as Error).message.slice(0, 200)}`);
    }
  }

  res.costUsd = Math.round(cost * 1e6) / 1e6;
  res.status = res.errors.length ? "error" : "done";
  res.detail = `ko ${res.saved.ko} · zh ${res.saved.zh} · en ${res.saved.en} 저장${opts.dry ? " (dry: 저장 안 함)" : ""}${res.problems.length ? ` · 뺀 것 ${res.problems.length}` : ""}${res.errors.length ? ` · 오류 ${res.errors.length}` : ""}`;
  if (!opts.dry && res.status === "done") await d.recordRun(ed.id, ed.date, res).catch((e) => console.error("[story-run] 기록 실패", (e as Error).message));
  return { ...res, rows: out };
}

async function dbDeps(): Promise<StoryRunDeps> {
  const pool = (await import("@/lib/db")).default;
  const { chat, parseJsonContent, TRANSLATE_MODEL, TRANSLATE_EFFORT, TRANSLATE_FALLBACK_MODEL, TRANSLATE_FALLBACK_EFFORT } = await import("./llm");
  const { PUBLIC_NEWS_WHERE } = await import("@/lib/news-query");
  const run = async (model: string, effort: LlmCall["effort"] | undefined, c: LlmCall) => {
    let cost = 0;
    const r = await chat({ model, effort, system: c.system, messages: [{ role: "user", content: c.user }], maxTokens: c.maxTokens, timeoutMs: 240_000 }, (u) => (cost += u.costUsd));
    return { raw: parseJsonContent(r.content), costUsd: cost };
  };
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
    hasRun: async (id) => (await pool.query(`SELECT 1 FROM briefing_story_runs WHERE briefing_id = $1::uuid`, [id])).rows.length > 0,
    existing: async (ids) => {
      const { rows } = await pool.query(`SELECT article_id::text AS id, lens, locale FROM briefing_story_context WHERE article_id = ANY($1::uuid[])`, [ids]);
      return new Set(rows.map((r: { id: string; lens: Lens; locale: string }) => key(r.id, r.lens, r.locale)));
    },
    todayArticles: async (ids) => {
      const { rows } = await pool.query(`SELECT id::text AS id, title_kr, summary_kr, title_cn FROM ai_news_ex WHERE id = ANY($1::uuid[])`, [ids]);
      return rows;
    },
    candidates: async (plan, edition, exclude) => {
      // 검색어는 story-gen.ts 가 이스케이프한 정규식 — SQL 에는 매개변수로만 넣는다
      const { rows } = await pool.query(
        `SELECT id::text AS id, to_char(news_date, 'YYYY-MM-DD') AS d, source_name AS s, title_kr, left(summary_kr, 220) AS summary_kr,
                title_cn, left(summary_cn, 220) AS summary_cn, title_en
           FROM ai_news_ex
          WHERE ${PUBLIC_NEWS_WHERE}
            AND news_date < $2::date AND news_date >= $2::date - $5::int
            AND NOT (id = ANY($3::uuid[]))
            AND (title_kr || ' ' || coalesce(summary_kr, '') || ' ' || coalesce(title_cn, '') || ' ' || coalesce(summary_cn, '')) ~* $1
            AND ($4::text IS NULL OR NOT (title_kr ~* $4 OR coalesce(title_cn, '') ~* $4))
          ORDER BY (title_kr ~* $1 OR coalesce(title_cn, '') ~* $1) DESC, news_date DESC
          LIMIT $6`,
        [plan.pattern, edition, exclude, plan.exclude, STORY_LOOKBACK_DAYS, STORY_MAX_CANDIDATES]
      );
      return (rows as Candidate[]).sort((a, b) => a.d.localeCompare(b.d));
    },
    koRows: async (ids) => {
      const { rows } = await pool.query(
        `SELECT article_id::text AS article_id, lens, locale, thread_title, background, timeline, now_text, caution
           FROM briefing_story_context WHERE article_id = ANY($1::uuid[]) AND locale = 'ko'`,
        [ids]
      );
      return rows as StoryRow[];
    },
    titles: async (ids) => {
      const { rows } = await pool.query(`SELECT id::text AS id, title_kr, title_cn, title_en FROM ai_news_ex WHERE id = ANY($1::uuid[])`, [ids]);
      return new Map(rows.map((r: { id: string; title_kr: string; title_cn: string; title_en: string | null }) => [r.id, r]));
    },
    llm: (c) => run(c.model ?? STORY_MODEL, c.effort, c),
    translateLlm: async (c, fallback) => {
      if (fallback && !TRANSLATE_FALLBACK_MODEL) return null;
      return fallback ? run(TRANSLATE_FALLBACK_MODEL!, TRANSLATE_FALLBACK_EFFORT as LlmCall["effort"], c) : run(TRANSLATE_MODEL, TRANSLATE_EFFORT as LlmCall["effort"], c);
    },
    save: async (rows, edition, model, costEach) => {
      let n = 0;
      for (const r of rows) {
        const q = await pool.query(
          `INSERT INTO briefing_story_context (article_id, lens, locale, edition_date, thread_title, background, timeline, now_text, caution, status, model, prompt_version, cost_usd)
           VALUES ($1::uuid, $2, $3, $4::date, $5, $6, $7::jsonb, $8, $9, 'auto', $10, $11, $12)
           ON CONFLICT (article_id, lens, locale) DO NOTHING`,
          [r.article_id, r.lens, r.locale, edition, r.thread_title, r.background, JSON.stringify(r.timeline), r.now_text, r.caution, model, STORY_PROMPT_VERSION, Math.round(costEach * 1e6) / 1e6]
        );
        n += q.rowCount ?? 0;
      }
      return n;
    },
    recordRun: async (id, date, r) => {
      await pool.query(
        `INSERT INTO briefing_story_runs (briefing_id, edition_date, result, cost_usd) VALUES ($1::uuid, $2::date, $3::jsonb, $4)
         ON CONFLICT (briefing_id) DO UPDATE SET result = EXCLUDED.result, cost_usd = EXCLUDED.cost_usd, created_at = now()`,
        [id, date, JSON.stringify({ detail: r.detail, saved: r.saved, problems: r.problems }), r.costUsd]
      );
    },
  };
}
