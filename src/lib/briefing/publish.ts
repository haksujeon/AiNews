/**
 * 발행·철회. MVP 에서는 관리자가 수동으로 승인해 발행한다.
 *
 *  - 발행 단위는 ko 판 한 버전 + 그 ko 에서 번역된 en/zh 중 draft 인 것.
 *    (en/zh 가 failed 여도 ko 발행은 막지 않는다. 그 언어는 발행본이 없게 된다)
 *  - 같은 날짜의 기존 발행본은 먼저 'superseded' 로 돌린다 (부분 유니크 인덱스 때문에 순서가 중요).
 *  - 검증 치명 위반이 남은 판은 발행하지 않는다.
 *  - 주간·월간: 기간에 결손일(수집 미완)이 있으면 관리자가 데이터 알림을 확인(acknowledgeDataQuality)해야 발행한다.
 *  - 데일리·주간·월간이 같은 함수를 쓴다 (editionType, 기본 'daily').
 *  - 철회는 공개 사유(reason)가 필수이고 public_note 에 남는다 (정정 기록, P0-6).
 *  - status_changed_at 은 DB 트리거(scripts/2026-11-02-briefing-corrections.sql)가 상태가 바뀔 때마다 채운다.
 */
import pool from "@/lib/db";
import type { BriefingLocale } from "./types";
import { EDITION_TYPE, type EditionType } from "./repository";

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

export async function publishBriefing(opts: {
  date: string;
  version?: number;
  editedBy?: string;
  editionType?: EditionType;
  /** 주간·월간: 결손일 데이터 알림을 확인했음 */
  acknowledgeDataQuality?: boolean;
}): Promise<PublishResult> {
  const editionType = opts.editionType ?? EDITION_TYPE;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows: koRows } = await client.query(
      `SELECT id, version, status, validation, content->'meta'->'data_quality' AS data_quality FROM daily_briefings
        WHERE edition_type = $1 AND edition_date = $2::date AND locale = 'ko'
          AND ($3::int IS NULL OR version = $3) AND ($3::int IS NOT NULL OR status = 'draft')
        ORDER BY version DESC LIMIT 1
        FOR UPDATE`,
      [editionType, opts.date, opts.version ?? null]
    );
    const ko = koRows[0];
    if (!ko) throw new PublishError("발행할 ko 초안이 없습니다", 404);
    if (ko.status !== "draft") throw new PublishError(`ko v${ko.version} 상태가 draft 가 아닙니다 (${ko.status})`, 409);
    const fatal = (ko.validation?.final?.fatal ?? []) as unknown[];
    if (fatal.length) throw new PublishError("검증 치명 위반이 남은 판은 발행할 수 없습니다", 409);
    const missing = (ko.data_quality?.incomplete_days ?? []) as unknown[];
    if (editionType !== "daily" && missing.length && !opts.acknowledgeDataQuality)
      throw new PublishError(`수집 미완 날짜(${missing.join(", ")})가 있는 판입니다. 데이터 알림을 확인한 뒤 발행하십시오`, 409);

    const sup = await client.query(
      `UPDATE daily_briefings SET status = 'superseded', updated_at = now()
        WHERE edition_type = $1 AND edition_date = $2::date AND status = 'published'`,
      [editionType, opts.date]
    );
    const { rows } = await client.query(
      `UPDATE daily_briefings
          SET status = 'published', published_at = now(), updated_at = now(), edited_by = COALESCE($3, edited_by)
        WHERE (id = $1 OR (source_briefing_id = $1 AND status = 'draft')) AND edition_date = $2::date AND edition_type = $4
        RETURNING locale, id, version`,
      [ko.id, opts.date, opts.editedBy ?? null, editionType]
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

/** 철회 사유 최대 길이 (공개 정정 기록에 그대로 나간다) */
export const WITHDRAW_REASON_MAX = 500;

/** 철회 사유 정리: 공백을 접고 자른다. 비어 있으면 null (호출 쪽이 4xx 로 거절) */
export function normalizeWithdrawReason(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const r = v.replace(/\s+/g, " ").trim().slice(0, WITHDRAW_REASON_MAX);
  return r.length >= 2 ? r : null;
}

/** 발행본 철회. locale 을 주지 않으면 그 날짜의 모든 언어판. 사유는 필수이며 public_note 에 저장한다 */
export async function withdrawBriefing(opts: {
  date: string;
  reason: string;
  locale?: BriefingLocale;
  editedBy?: string;
  editionType?: EditionType;
}): Promise<number> {
  const reason = normalizeWithdrawReason(opts.reason);
  if (!reason) throw new PublishError("철회 사유가 필요합니다", 400);
  const { rowCount } = await pool.query(
    `UPDATE daily_briefings
        SET status = 'withdrawn', updated_at = now(), edited_by = COALESCE($4, edited_by), public_note = $5
      WHERE edition_type = $1 AND edition_date = $2::date AND status = 'published' AND ($3::text IS NULL OR locale = $3)`,
    [opts.editionType ?? EDITION_TYPE, opts.date, opts.locale ?? null, opts.editedBy ?? null, reason]
  );
  return rowCount ?? 0;
}
