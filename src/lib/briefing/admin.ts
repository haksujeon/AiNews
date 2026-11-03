/**
 * 관리자 검토 — 목록·상세 읽기와 인라인 수정 저장.
 *
 * 수정 저장 규칙 (설계 검토서 §3.8):
 *  - ko 판의 headline / lede / 주요 기사 title·what·why 만 고친다.
 *  - 생성 때와 같은 validateKo 를 다시 돌리고(근거는 그 판의 후보 기사), 치명 위반이 있으면 저장하지 않는다.
 *  - 저장은 언제나 version+1 의 새 draft 행. 원래 행은 건드리지 않는다.
 *  - 새 ko 버전에는 en/zh 번역본이 없다 (발행하면 ko 만 발행된다 — 검토 화면이 경고한다).
 */
import pool from "@/lib/db";
import { PUBLIC_NEWS_WHERE } from "@/lib/news-query";
import { ROW_COLUMNS, insertBriefing, type BriefingRow, type EditionType } from "./repository";
import type { BriefingContent, CandidateArticle, StoredBriefingContent, ValidationIssue, ValidationReport } from "./types";
import { citedRefs, contextFromArticles, validateKo } from "./validate";
import { SOURCE_ARTICLE_COLUMNS } from "./columns";

export interface AdminBriefingListRow {
  id: string;
  edition_type: EditionType;
  edition_date: string;
  period_end: string | null;
  /** 주간·월간 기간 키 (2026-W44 / 2026-10). 데일리는 null */
  period_key: string | null;
  /** 주간·월간: 결손일 등 데이터 알림이 있어 발행 전 확인이 필요한가 */
  data_quality: boolean;
  locale: string;
  version: number;
  status: string;
  mode: string;
  headline: string | null;
  error: string | null;
  fatal: number;
  warn: number;
  cost_usd: string | null;
  needs_review: boolean;
  source_briefing_id: string | null;
  created_at: string;
  published_at: string | null;
}

/**
 * 최근 판 목록. 치명·경고 수: ko 는 validation.final, en/zh 는 번역 재검증 문제 수(치명으로 셈).
 * editionType 을 주면 그 유형만 (관리자 목록의 유형 필터), 없으면 전체.
 */
export async function listBriefingsForAdmin(limit = 150, editionType?: EditionType): Promise<AdminBriefingListRow[]> {
  const { rows } = await pool.query(
    `SELECT id, edition_type, to_char(edition_date, 'YYYY-MM-DD') AS edition_date, to_char(period_end, 'YYYY-MM-DD') AS period_end,
            COALESCE(content->'meta'->>'period_key', content->'meta'->>'iso_week', content->'meta'->>'month') AS period_key,
            COALESCE(jsonb_array_length(content->'meta'->'data_quality'->'incomplete_days'), 0) > 0 AS data_quality,
            locale, version, status, mode,
            content->>'headline' AS headline, error, cost_usd, needs_review, source_briefing_id, created_at, published_at,
            CASE WHEN locale = 'ko' THEN COALESCE(jsonb_array_length(validation->'final'->'fatal'), 0)
                 ELSE COALESCE(jsonb_array_length(validation->'problems'), 0) END AS fatal,
            CASE WHEN locale = 'ko' THEN COALESCE(jsonb_array_length(validation->'final'->'warn'), 0) ELSE 0 END AS warn
       FROM daily_briefings
      WHERE ($1::text IS NULL OR edition_type = $1)
      ORDER BY edition_date DESC, created_at DESC
      LIMIT $2`,
    [editionType ?? null, limit]
  );
  return rows as AdminBriefingListRow[];
}

/** 유형과 관계없이 id 로 한 행 (관리자 상세는 edition_type 을 보고 데일리/주간 화면을 고른다) */
export async function getBriefingRow(id: string): Promise<BriefingRow | null> {
  const { rows } = await pool.query(`SELECT ${ROW_COLUMNS} FROM daily_briefings WHERE id = $1::uuid`, [id]);
  return (rows[0] as BriefingRow) ?? null;
}

/** 이 ko 버전에서 번역된 en/zh 행 */
export async function translationsOf(koId: string): Promise<{ id: string; locale: string; version: number; status: string }[]> {
  const { rows } = await pool.query(
    `SELECT id, locale, version, status FROM daily_briefings WHERE source_briefing_id = $1::uuid ORDER BY locale`,
    [koId]
  );
  return rows;
}

// ───────────────────────── 인라인 수정

export interface BriefingTextPatch {
  headline?: string;
  lede?: string;
  top_stories?: { title?: string; what?: string; why?: string }[];
}

const MAX_FIELD = 600;

/** 텍스트 필드만 덮어쓴 복사본 (순수 함수). 구조·refs 는 바꾸지 않는다 */
export function applyTextPatch<T extends BriefingContent>(content: T, patch: BriefingTextPatch): T {
  const c: T = structuredClone(content);
  const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, MAX_FIELD) : undefined);
  const h = clean(patch.headline);
  if (h) c.headline = h;
  const l = clean(patch.lede);
  if (l) c.lede = l;
  (patch.top_stories ?? []).forEach((p, i) => {
    const s = c.top_stories[i];
    if (!s || !p) return;
    for (const k of ["title", "what", "why"] as const) {
      const v = clean(p[k]);
      if (v) s[k] = v;
    }
  });
  return c;
}

export type SaveEditResult =
  | { ok: true; id: string | null; version: number | null; report: ValidationReport }
  | { ok: false; status: number; message: string; issues?: ValidationIssue[] };

/** dryRun 이면 검증만 하고 저장하지 않는다 (관리자 화면의 "검증만" · 테스트용) */
export async function saveEditedBriefing(
  id: string,
  patch: BriefingTextPatch,
  opts: { editedBy?: string; dryRun?: boolean } = {}
): Promise<SaveEditResult> {
  const row = await getBriefingRow(id);
  if (!row) return { ok: false, status: 404, message: "briefing not found" };
  if (row.edition_type !== "daily") return { ok: false, status: 400, message: "only daily briefings can be edited inline" };
  if (row.locale !== "ko") return { ok: false, status: 400, message: "only ko versions can be edited" };
  const stored = row.content as unknown as StoredBriefingContent;
  if (!stored?.top_stories?.length || !["draft", "published", "superseded"].includes(row.status))
    return { ok: false, status: 409, message: `version ${row.version} (${row.status}) has no editable content` };

  const ids = [...new Set([...(row.input_article_ids ?? []), ...(row.article_ids ?? [])])];
  const { rows: arts } = await pool.query(
    `SELECT ${SOURCE_ARTICLE_COLUMNS}, (${PUBLIC_NEWS_WHERE}) AS visible
       FROM ai_news_ex WHERE id = ANY($1::uuid[])`,
    [ids]
  );
  const articles = arts.map((a) => ({ ...a, key_terms: Array.isArray(a.key_terms) ? a.key_terms : [] })) as (CandidateArticle & {
    visible: boolean;
  })[];
  const hidden = new Set(articles.filter((a) => !a.visible).map((a) => a.id));
  // 생성 때와 같은 의미 규칙(예전 사건 시점 등)을 쓰도록 판 시작일을 넘긴다
  // 중국 할당은 생성 때 저장한 믿을 만한 중국 후보 수로 (결정 D3, 생성과 같은 기준 — Gate 2)
  const credible = (stored as { meta?: { china_credible?: unknown } }).meta?.china_credible;
  const ctx = contextFromArticles(articles, row.mode, hidden, row.period_start ?? row.edition_date, typeof credible === "number" ? credible : undefined);

  const { meta, ...body } = stored;
  const edited = applyTextPatch(body as BriefingContent, patch);
  const { content, report } = validateKo(edited, ctx);
  if (report.fatal.length) return { ok: false, status: 422, message: "validation failed", issues: report.fatal };
  if (opts.dryRun) return { ok: true, id: null, version: null, report };

  const articleIds = [...new Set(citedRefs(content))];
  const inserted = await insertBriefing({
    date: row.edition_date,
    locale: "ko",
    status: "draft",
    mode: row.mode,
    content: { ...content, meta: { ...meta, cited_count: articleIds.length } },
    articleIds,
    inputArticleIds: row.input_article_ids ?? [],
    candidateCount: row.candidate_count,
    inputHash: row.input_hash,
    validation: { prompt_version: row.prompt_version, edited_from: { id: row.id, version: row.version }, final: report },
    model: row.model,
    promptVersion: row.prompt_version,
    costUsd: 0,
  });
  await pool.query(`UPDATE daily_briefings SET edited_by = $2 WHERE id = $1`, [inserted.id, opts.editedBy ?? "admin"]);
  return { ok: true, id: inserted.id, version: inserted.version, report };
}
