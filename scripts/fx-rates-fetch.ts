/**
 * 환율 받아 오기 (금액 환산 표기, src/lib/fx). ECB 기준 환율을 Frankfurter(키 없음)에서 받아 fx_rates 에 저장한다.
 * 예약: crontab 매일 16:30 UTC (ECB 발표 16:00 CET 뒤, 01:30 KST — 수집 시간 밖)
 *
 *   npx tsx scripts/fx-rates-fetch.ts                    # 최근 10일 (휴일 메우기 포함, 같은 날짜는 덮어씀)
 *   npx tsx scripts/fx-rates-fetch.ts --from 2026-08-01  # 그날부터 오늘까지 (처음 채우기)
 */
import { loadEnvConfig } from "@next/env";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  loadEnvConfig(process.cwd());
  const { default: pool } = await import("../src/lib/db");
  const { saveFxRates, FX_CURRENCIES } = await import("../src/lib/fx/store");
  const today = new Date().toISOString().slice(0, 10);
  const from = arg("from") ?? new Date(Date.now() - 10 * 86400_000).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) throw new Error("--from YYYY-MM-DD");
  const symbols = FX_CURRENCIES.filter((c) => c !== "USD").join(",");
  const url = `https://api.frankfurter.dev/v1/${from}..${today}?base=USD&symbols=${symbols}`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`Frankfurter ${res.status}`);
    const body = (await res.json()) as { rates?: Record<string, Record<string, unknown>> };
    const days = Object.entries(body.rates ?? {});
    let saved = 0;
    for (const [d, r] of days) {
      const perUsd: Record<string, number> = { USD: 1 };
      for (const c of FX_CURRENCIES) if (c !== "USD" && typeof r[c] === "number" && (r[c] as number) > 0) perUsd[c] = r[c] as number;
      // 다섯 통화가 다 있어야 저장한다 (빠진 날은 직전 영업일로 대신된다)
      if (Object.keys(perUsd).length !== FX_CURRENCIES.length) continue;
      await saveFxRates(d, perUsd);
      saved++;
    }
    const last = days.at(-1);
    console.log(`${new Date().toISOString()} fx ${from}..${today}: ${saved}/${days.length}일 저장${last ? ` · 마지막 ${last[0]} KRW ${last[1].KRW} CNY ${last[1].CNY}` : ""}`);
    if (!saved) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
