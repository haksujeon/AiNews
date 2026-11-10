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

export async function ensurePeriodicTranslations(koId: string): Promise<PeriodicTranslateOutcome[]> {
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
