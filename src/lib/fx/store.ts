/**
 * 환율 읽기·쓰기 (fx_rates, scripts/2026-11-06-fx-rates.sql). 화면은 loadFxRates 하나로 읽는다 (Gate 2).
 * 그 날짜 이하의 가장 최근 줄 = 휴일·주말이면 직전 영업일 환율. 표가 없거나 비면 null (환산 표기만 없다).
 */
import pool from "@/lib/db";
import type { Currency } from "../briefing/quantity";
import type { FxRates } from "./convert";

export const FX_CURRENCIES: Currency[] = ["USD", "CNY", "KRW", "HKD", "JPY", "EUR"];

/** 7일 넘게 묵은 환율은 쓰지 않는다 (받아 오기가 멈춘 경우) */
const MAX_AGE_DAYS = 7;

const cache = new Map<string, { at: number; v: FxRates | null }>();

export async function loadFxRates(date: string): Promise<FxRates | null> {
  const hit = cache.get(date);
  if (hit && Date.now() - hit.at < 10 * 60_000) return hit.v;
  let v: FxRates | null = null;
  try {
    const { rows } = await pool.query(
      `SELECT to_char(rate_date, 'YYYY-MM-DD') AS d, per_usd, source FROM fx_rates
        WHERE rate_date <= $1::date AND rate_date > $1::date - $2::int ORDER BY rate_date DESC LIMIT 1`,
      [date, MAX_AGE_DAYS]
    );
    const r = rows[0] as { d: string; per_usd: Record<string, unknown>; source: string } | undefined;
    if (r) {
      const perUsd = { USD: 1 } as Record<Currency, number>;
      for (const c of FX_CURRENCIES) {
        const x = Number(r.per_usd?.[c]);
        if (c !== "USD" && Number.isFinite(x) && x > 0) perUsd[c] = x;
      }
      v = { date: r.d, source: r.source, perUsd };
    }
  } catch (e) {
    // 표가 아직 없는 환경(테스트·새 DB) — 환산 없이 화면은 그대로
    if ((e as { code?: string }).code !== "42P01") console.error("[fx] loadFxRates", e);
  }
  cache.set(date, { at: Date.now(), v });
  return v;
}

/** 받아 온 하루치 저장 (같은 날짜는 덮어쓴다) */
export async function saveFxRates(date: string, perUsd: Record<string, number>, source = "ECB"): Promise<void> {
  await pool.query(
    `INSERT INTO fx_rates (rate_date, per_usd, source) VALUES ($1::date, $2::jsonb, $3)
     ON CONFLICT (rate_date) DO UPDATE SET per_usd = EXCLUDED.per_usd, source = EXCLUDED.source, fetched_at = now()`,
    [date, JSON.stringify(perUsd), source]
  );
}
