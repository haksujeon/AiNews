/**
 * 발행·철회. MVP 에서는 관리자가 수동으로 승인해 발행한다.
 *
 *  - 발행 단위는 ko 판 한 버전 + 그 ko 에서 번역된 en/zh 중 draft 인 것.
 *    (en/zh 가 failed 여도 ko 발행은 막지 않는다. 그 언어는 발행본이 없게 된다)
 *  - 같은 날짜의 기존 발행본은 먼저 'superseded' 로 돌린다 (부분 유니크 인덱스 때문에 순서가 중요).
 *  - 검증 치명 위반이 남은 판은 발행하지 않는다.
 */
import pool from "@/lib/db";
import type { BriefingLocale } from "./types";
import { EDITION_TYPE } from "./repository";

export class PublishError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "PublishError";
  }
}

export interface PublishResult {
  date: string;
  published: { locale: BriefingLocale; id: string; version: number }[];
  superseded: number;
}

export async function publishBriefing(opts: { date: string; version?: number; editedBy?: string }): Promise<PublishResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: koRows } = await client.query(
      `SELECT id, version, status, validation FROM daily_briefings
        WHERE edition_type = $1 AND edition_date = $2::date AND locale = 'ko'
          AND ($3::int IS NULL OR version = $3) AND ($3::int IS NOT NULL OR status = 'draft')
        ORDER BY version DESC LIMIT 1
        FOR UPDATE`,
      [EDITION_TYPE, opts.date, opts.version ?? null]
    );
    const ko = koRows[0];
    if (!ko) throw new PublishError("발행할 ko 초안이 없습니다", 404);
    if (ko.status !== "draft") throw new PublishError(`ko v${ko.version} 상태가 draft 가 아닙니다 (${ko.status})`, 409);
    const fatal = (ko.validation?.final?.fatal ?? []) as unknown[];
    if (fatal.length) throw new PublishError("검증 치명 위반이 남은 판은 발행할 수 없습니다", 409);

    const sup = await client.query(
      `UPDATE daily_briefings SET status = 'superseded', updated_at = now()
        WHERE edition_type = $1 AND edition_date = $2::date AND status = 'published'`,
      [EDITION_TYPE, opts.date]
    );
    const { rows } = await client.query(
      `UPDATE daily_briefings
          SET status = 'published', published_at = now(), updated_at = now(), edited_by = COALESCE($3, edited_by)
        WHERE (id = $1 OR (source_briefing_id = $1 AND status = 'draft')) AND edition_date = $2::date
        RETURNING locale, id, version`,
      [ko.id, opts.date, opts.editedBy ?? null]
    );
    await client.query("COMMIT");
    return { date: opts.date, published: rows, superseded: sup.rowCount ?? 0 };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** 발행본 철회. locale 을 주지 않으면 그 날짜의 모든 언어판 */
export async function withdrawBriefing(opts: { date: string; locale?: BriefingLocale; editedBy?: string }): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE daily_briefings SET status = 'withdrawn', updated_at = now(), edited_by = COALESCE($4, edited_by)
      WHERE edition_type = $1 AND edition_date = $2::date AND status = 'published' AND ($3::text IS NULL OR locale = $3)`,
    [EDITION_TYPE, opts.date, opts.locale ?? null, opts.editedBy ?? null]
  );
  return rowCount ?? 0;
}
