/**
 * 발행된 주간·월간 ko 판 → en·zh 판 만들기·공개 (2026-11-10 사용자 결정: 주간·월간도 영어·중국어판).
 *
 * 한국어판이 발행된 뒤에 부른다 — AI 검토 수정으로 ko 버전이 바뀔 때마다 다시 번역하지 않고, 공개된 ko 판 그대로를 옮긴다.
 * 부르는 곳: AI 검토 자동 발행(pipeline.ts), 관리자 발행(api/admin/briefing/publish), CLI(scripts/briefing-generate.ts translate-periodic).
 * 번역 재검증(칸별 숫자·이름·글자)을 통과한 언어판만 published 로, 아니면 failed 로 남긴다(공개 안 됨 — en·zh 화면은 "이 언어로는 없음" 안내).
 * 이미 그 ko 판에서 번역해 공개한 언어는 건너뛴다(여러 번 불러도 안전).
 */
import pool from "@/lib/db";
import { insertBriefing } from "../repository";
import { sumUsage } from "../generate";
import { nameGlossaryLinesOf } from "../translate";
import { PERIODIC_TRANSLATE_PROMPT_VERSION, periodicTranslateFields, translatePeriodic } from "./translate";
import type { StoredPeriodicContent } from "./types";

export interface PeriodicTranslateOutcome {
  locale: "en" | "zh";
  status: "published" | "failed" | "skipped";
  detail: string;
  costUsd: number;
}

interface KoRow {
  id: string;
  edition_type: "weekly" | "monthly";
  edition_date: string;
  period_start: string;
  period_end: string;
  metrics_id: string | null;
  mode: string;
  content: StoredPeriodicContent;
  article_ids: string[];
  input_article_ids: string[];
  candidate_count: number;
  input_hash: string;
}

export async function ensurePeriodicTranslations(koId: string, opts: { maxFailed?: number } = {}): Promise<PeriodicTranslateOutcome[]> {
  const { rows } = await pool.query(
    `SELECT id, edition_type, to_char(edition_date, 'YYYY-MM-DD') AS edition_date, to_char(period_start, 'YYYY-MM-DD') AS period_start,
            to_char(period_end, 'YYYY-MM-DD') AS period_end, metrics_id, mode, content, article_ids, input_article_ids, candidate_count, input_hash
       FROM daily_briefings WHERE id = $1::uuid AND locale = 'ko' AND status = 'published' AND edition_type IN ('weekly', 'monthly')`,
    [koId]
  );
  const ko = rows[0] as KoRow | undefined;
  if (!ko) return [];
  const { rows: hintRows } = await pool.query(`SELECT title_kr, title_cn FROM ai_news_ex WHERE id = ANY($1::uuid[]) LIMIT 60`, [ko.article_ids]);
  const nameHints = (hintRows as { title_kr: string | null; title_cn: string | null }[])
    .filter((h) => h.title_kr && h.title_cn)
    .map((h) => ({ title_kr: h.title_kr!, title_cn: h.title_cn! }));
  const glossary = nameGlossaryLinesOf(periodicTranslateFields(ko.content).map((f) => f.get(ko.content) ?? "").join(" "));

  const out: PeriodicTranslateOutcome[] = [];
  for (const locale of ["en", "zh"] as const) {
    const { rows: done } = await pool.query(
      `SELECT 1 FROM daily_briefings WHERE source_briefing_id = $1::uuid AND locale = $2 AND status = 'published' LIMIT 1`,
      [ko.id, locale]
    );
    if (done.length) {
      out.push({ locale, status: "skipped", detail: "이미 번역·공개됨", costUsd: 0 });
      continue;
    }
    if (opts.maxFailed !== undefined) {
      const { rows: f } = await pool.query(`SELECT count(*)::int AS n FROM daily_briefings WHERE source_briefing_id = $1::uuid AND locale = $2 AND status = 'failed'`, [ko.id, locale]);
      if ((f[0]?.n ?? 0) >= opts.maxFailed) {
        out.push({ locale, status: "skipped", detail: `실패 ${f[0].n}회 — 사람이 확인`, costUsd: 0 });
        continue;
      }
    }
    const tr = await translatePeriodic(ko.content, locale, ko.edition_type, { nameHints, glossary });
    const u = sumUsage(tr.usages);
    const ok = Boolean(tr.content);
    const shown = tr.content ?? tr.candidate;
    const content = shown ? { ...shown, meta: { ...ko.content.meta, locale } } : {};
    const error = ok ? null : tr.error ?? `번역 재검증 실패 (${tr.problems.length}건)`;
    const row = await insertBriefing({
      editionType: ko.edition_type, date: ko.edition_date, periodStart: ko.period_start, periodEnd: ko.period_end, metricsId: ko.metrics_id,
      locale, status: ok ? "draft" : "failed", mode: ko.mode as "normal", content, articleIds: ko.article_ids, inputArticleIds: ko.input_article_ids,
      candidateCount: ko.candidate_count, inputHash: ko.input_hash,
      validation: { prompt_version: PERIODIC_TRANSLATE_PROMPT_VERSION, problems: tr.problems },
      sourceBriefingId: ko.id, model: tr.model, promptVersion: PERIODIC_TRANSLATE_PROMPT_VERSION, ...u, error,
    });
    if (ok) {
      // ko 판이 이미 공개됐으므로 그 판의 번역도 바로 공개 (같은 언어의 예전 공개본은 superseded)
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          `UPDATE daily_briefings SET status = 'superseded', updated_at = now()
            WHERE edition_type = $1 AND edition_date = $2::date AND locale = $3 AND status = 'published'`,
          [ko.edition_type, ko.edition_date, locale]
        );
        await client.query(
          `UPDATE daily_briefings SET status = 'published', published_at = now(), updated_at = now(), edited_by = 'auto-translate' WHERE id = $1::uuid`,
          [row.id]
        );
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK").catch(() => {});
        throw e;
      } finally {
        client.release();
      }
    }
    out.push({ locale, status: ok ? "published" : "failed", detail: ok ? `v${row.version}` : error ?? "", costUsd: u.costUsd });
  }
  return out;
}

/** 알림 한 줄 */
export function periodicTranslateNote(list: PeriodicTranslateOutcome[]): string {
  if (!list.length) return "";
  return `번역 ${list.map((x) => `${x.locale} ${x.status === "published" ? "공개" : x.status === "skipped" ? "이미 있음" : `실패(${x.detail})`}`).join(", ")}`;
}

/** 그 판(유형·시작일)의 공개 ko 판을 찾아 번역 — AI 검토 자동 발행·관리자 발행 뒤처리 */
export async function ensurePeriodicTranslationsFor(editionType: "weekly" | "monthly", date: string): Promise<PeriodicTranslateOutcome[]> {
  const { rows } = await pool.query(
    `SELECT id FROM daily_briefings WHERE edition_type = $1 AND edition_date = $2::date AND locale = 'ko' AND status = 'published' LIMIT 1`,
    [editionType, date]
  );
  return rows[0] ? ensurePeriodicTranslations(rows[0].id) : [];
}

/** 따라잡기에서 한 언어를 다시 시도하는 최대 실패 수 (그 뒤엔 사람이 CLI translate-periodic 으로) */
const MAX_FAILED_TRIES = 3;

/**
 * 최근 14일 안에 공개된 주간·월간 ko 판 중 en·zh 공개본이 빠진 판을 다시 번역 (AI 검토 스윕 끝, 한 번에 최대 2판).
 * 일시 오류로 빠진 번역을 다음 스윕이 메운다. 같은 언어가 MAX_FAILED_TRIES 번 실패했으면 더 시도하지 않는다.
 */
export async function catchUpPeriodicTranslations(): Promise<string> {
  const { rows } = await pool.query(
    `SELECT ko.id FROM daily_briefings ko
      WHERE ko.locale = 'ko' AND ko.status = 'published' AND ko.edition_type IN ('weekly', 'monthly')
        AND ko.published_at > now() - interval '14 days'
        AND EXISTS (
          SELECT 1 FROM (VALUES ('en'), ('zh')) AS l(loc)
           WHERE NOT EXISTS (SELECT 1 FROM daily_briefings t WHERE t.source_briefing_id = ko.id AND t.locale = l.loc AND t.status = 'published')
             AND (SELECT count(*) FROM daily_briefings t WHERE t.source_briefing_id = ko.id AND t.locale = l.loc AND t.status = 'failed') < $1)
      ORDER BY ko.published_at DESC LIMIT 2`,
    [MAX_FAILED_TRIES]
  );
  const notes: string[] = [];
  for (const r of rows as { id: string }[]) {
    const n = periodicTranslateNote(await ensurePeriodicTranslations(r.id, { maxFailed: MAX_FAILED_TRIES }));
    if (n) notes.push(n);
  }
  return notes.length ? `주간·월간 ${notes.join(" / ")}` : "";
}
