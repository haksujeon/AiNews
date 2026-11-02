/**
 * 정정 기록 (P0-6). 공개 /corrections 페이지가 이 함수만 쓴다.
 *
 *  - 대상: 한 번 발행됐다가 철회(withdrawn)되거나 새 버전으로 교체(superseded)된 판. 데일리·주간 모두.
 *  - cutoff(결정 D6 = 첫 정식 발행일): 발행 시각(published_at)이 cutoff 이후인 판만. 출시 전 시험 판은 나오지 않는다.
 *      1) env CORRECTIONS_SINCE (YYYY-MM-DD 또는 ISO 시각)가 있으면 그것.
 *      2) 없으면 LAUNCH_FLOOR 이후 가장 이른 published_at. (정정 컬럼 마이그레이션 날짜 — 그 전의 발행은 모두 시험)
 *         지금 발행된 판만 보면 그 판이 나중에 교체·철회될 때 cutoff 가 뒤로 밀려 정정 기록이 사라지므로 쓰지 않는다.
 *      3) 그런 발행이 없으면 null → 빈 목록.
 *  - 사유: public_note(철회 사유). 비어 있으면 화면이 언어별 기본 문구를 쓴다(reason = null).
 *  - 대체판: 같은 (유형, 날짜, 언어)에서 그 판 다음에 발행된 판. 그 판이 지금 발행 상태일 때만 링크를 단다.
 *    버전 번호는 언어마다 다르게 올라가므로(ko v5 → v8, en v5 → v7) version+1 이 아니라 발행 시각 순서로 찾는다.
 *
 * buildCorrections 는 순수 함수(단위 테스트), listCorrections 가 DB 를 읽는다.
 */
import pool from "@/lib/db";
import type { BriefingLocale } from "./types";
import { briefingDatePath } from "./view";
import { WEEKLY_PATH } from "@/components/briefing/briefing-tabs";

/** 정식 발행 하한 — 이보다 앞선 발행은 모두 출시 전 시험이다 (scripts/2026-11-02-briefing-corrections.sql) */
export const LAUNCH_FLOOR = "2026-11-02T00:00:00+09:00";

export type CorrectionKind = "withdrawn" | "superseded";

export interface CorrectionSourceRow {
  id: string;
  edition_type: string;
  edition_date: string; // YYYY-MM-DD
  iso_week: string | null;
  locale: string;
  version: number;
  status: string;
  published_at: string | Date | null;
  changed_at: string | Date | null;
  public_note: string | null;
}

export interface Correction {
  id: string;
  kind: CorrectionKind;
  edition_type: "daily" | "weekly";
  edition_date: string;
  /** 독자에게 보이는 판 이름: 데일리 = 날짜, 주간 = ISO 주 */
  edition_label: string;
  version: number;
  published_at: string;
  changed_at: string;
  /** 공개 사유. 없으면 null (화면이 기본 문구) */
  reason: string | null;
  /** 지금 발행 중인 대체판 경로(로케일 뒤). 없으면 null */
  replacement: { path: string; version: number } | null;
}

const iso = (v: string | Date | null): string | null => (v == null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString());

/** env 값 → cutoff ISO. 잘못된 값이면 null (기본 규칙으로 넘어간다) */
export function parseSince(v: string | undefined | null): string | null {
  if (!v || !v.trim()) return null;
  const s = v.trim();
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00+09:00` : s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function editionPath(r: CorrectionSourceRow): string | null {
  if (r.edition_type === "daily") return briefingDatePath(r.edition_date);
  if (r.edition_type === "weekly" && r.iso_week) return `${WEEKLY_PATH}/${r.iso_week}`;
  return null;
}

/**
 * 같은 판 계열(유형·날짜·언어)의 행들 → 정정 항목. since 가 null 이면 빈 목록.
 * rows 에는 published_at 이 있는 행(published·superseded·withdrawn)을 넣는다.
 */
export function buildCorrections(rows: CorrectionSourceRow[], since: string | null): Correction[] {
  if (!since) return [];
  const sinceMs = new Date(since).getTime();
  const groups = new Map<string, CorrectionSourceRow[]>();
  for (const r of rows) {
    if (!r.published_at || (r.edition_type !== "daily" && r.edition_type !== "weekly")) continue;
    const k = `${r.edition_type}|${r.edition_date}|${r.locale}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }

  const out: Correction[] = [];
  for (const g of groups.values()) {
    g.sort((a, b) => new Date(a.published_at!).getTime() - new Date(b.published_at!).getTime() || a.version - b.version);
    g.forEach((r, i) => {
      if (r.status !== "withdrawn" && r.status !== "superseded") return;
      const published = iso(r.published_at)!;
      if (new Date(published).getTime() < sinceMs) return;
      const next = g.slice(i + 1).find((x) => new Date(x.published_at!).getTime() >= new Date(published).getTime() && x.id !== r.id);
      const path = editionPath(r);
      const note = r.public_note?.replace(/\s+/g, " ").trim();
      out.push({
        id: r.id,
        kind: r.status,
        edition_type: r.edition_type as "daily" | "weekly",
        edition_date: r.edition_date,
        edition_label: r.edition_type === "weekly" && r.iso_week ? r.iso_week : r.edition_date,
        version: r.version,
        published_at: published,
        changed_at: iso(r.changed_at) ?? published,
        reason: note ? note : null,
        replacement: next && next.status === "published" && path ? { path, version: next.version } : null,
      });
    });
  }
  return out.sort((a, b) => b.changed_at.localeCompare(a.changed_at) || b.edition_date.localeCompare(a.edition_date));
}

/** cutoff: env CORRECTIONS_SINCE → LAUNCH_FLOOR 이후 첫 발행 → null */
export async function resolveCorrectionsSince(): Promise<string | null> {
  const fromEnv = parseSince(process.env.CORRECTIONS_SINCE);
  if (fromEnv) return fromEnv;
  const { rows } = await pool.query(
    `SELECT MIN(published_at) AS first FROM daily_briefings
      WHERE published_at IS NOT NULL AND published_at >= $1::timestamptz AND edition_type IN ('daily', 'weekly')`,
    [LAUNCH_FLOOR]
  );
  return iso(rows[0]?.first ?? null);
}

/** 그 언어의 정정 기록 (최신 변경순). since 를 주지 않으면 resolveCorrectionsSince() */
export async function listCorrections(locale: BriefingLocale, since?: string | null): Promise<Correction[]> {
  const cutoff = since === undefined ? await resolveCorrectionsSince() : since;
  if (!cutoff) return [];
  const { rows } = await pool.query(
    `SELECT id, edition_type, to_char(edition_date, 'YYYY-MM-DD') AS edition_date, content->'meta'->>'iso_week' AS iso_week,
            locale, version, status, published_at, COALESCE(status_changed_at, updated_at) AS changed_at, public_note
       FROM daily_briefings
      WHERE locale = $1 AND edition_type IN ('daily', 'weekly') AND published_at IS NOT NULL
        AND status IN ('published', 'superseded', 'withdrawn')
        AND (edition_type, edition_date) IN (
          SELECT edition_type, edition_date FROM daily_briefings
           WHERE locale = $1 AND status IN ('superseded', 'withdrawn') AND published_at >= $2::timestamptz)`,
    [locale, cutoff]
  );
  return buildCorrections(rows as CorrectionSourceRow[], cutoff);
}
