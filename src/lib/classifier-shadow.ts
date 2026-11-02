/**
 * 그림자 분류 기록(로봇 범위 1단계) — 요청 본문 검사. DB 를 부르지 않는다(단위 테스트에서 그대로 쓴다).
 * 테이블: scripts/2026-11-02-classifier-shadow.sql, 라우트: /api/internal/classifier-shadow.
 */

export const SHADOW_MAX_ROWS = 300;

export interface ShadowRow {
  item_url: string;
  title: string | null;
  source_name: string | null;
  current_relevant: boolean | null;
  current_category: string | null;
  current_subject: string | null;
  current_kept: boolean | null;
  current_capped: boolean | null;
  v3_relevant: boolean | null;
  v3_category: string | null;
  v3_subject: string | null;
  current_mode: string | null;
  v3_mode: string | null;
}

export type ShadowParse =
  | { ok: true; runId: string; promptVersion: string; rows: ShadowRow[]; skipped: number }
  | { ok: false; message: string };

const CAT_RE = /^[a-z][a-z-]{0,19}$/;
const RUN_RE = /^[A-Za-z0-9_.:-]{1,64}$/;

const str = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, max) : null;
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);
const cat = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  return CAT_RE.test(s) ? s : null;
};

/** 본문 { run_id, prompt_version?, rows: [...] } 검사. item_url 이 없는 행은 건너뛴다(개수만 센다) */
export function parseShadowBody(body: unknown): ShadowParse {
  if (!body || typeof body !== "object") return { ok: false, message: "body must be an object" };
  const b = body as Record<string, unknown>;
  const runId = typeof b.run_id === "number" ? String(b.run_id) : typeof b.run_id === "string" ? b.run_id.trim() : "";
  if (!RUN_RE.test(runId)) return { ok: false, message: "run_id is required" };
  if (!Array.isArray(b.rows)) return { ok: false, message: "rows must be an array" };
  if (b.rows.length > SHADOW_MAX_ROWS) return { ok: false, message: `rows must be at most ${SHADOW_MAX_ROWS}` };
  const promptVersion = str(b.prompt_version, 20) ?? "v3";
  const rows: ShadowRow[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const raw of b.rows) {
    const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const url = str(r.item_url, 2048);
    if (!url || !/^https?:\/\//i.test(url) || seen.has(url)) {
      skipped++;
      continue;
    }
    seen.add(url);
    rows.push({
      item_url: url,
      title: str(r.title, 300),
      source_name: str(r.source_name, 50),
      current_relevant: bool(r.current_relevant),
      current_category: cat(r.current_category),
      current_subject: str(r.current_subject, 120),
      current_kept: bool(r.current_kept),
      current_capped: bool(r.current_capped),
      v3_relevant: bool(r.v3_relevant),
      v3_category: cat(r.v3_category),
      v3_subject: str(r.v3_subject, 120),
      current_mode: str(r.current_mode, 20),
      v3_mode: str(r.v3_mode, 20),
    });
  }
  return { ok: true, runId, promptVersion, rows, skipped };
}

/** INSERT 한 번(unnest)으로 넣는 열 순서. 라우트와 테스트가 같이 쓴다 */
export const SHADOW_COLUMNS = [
  "item_url", "title", "source_name", "current_relevant", "current_category", "current_subject",
  "current_kept", "current_capped", "v3_relevant", "v3_category", "v3_subject", "current_mode", "v3_mode",
] as const satisfies readonly (keyof ShadowRow)[];
