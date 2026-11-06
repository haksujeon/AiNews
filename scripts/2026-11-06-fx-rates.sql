-- 금액 환산 표기용 환율 (2026-11-06, src/lib/fx). 하루 한 줄: 1달러 = 몇 그 통화 (ECB 기준, Frankfurter).
-- 화면이 판·기사 날짜 이하의 가장 최근 줄을 읽는다(휴일 = 직전 영업일). 표가 없거나 비면 환산 표기만 없다.
-- 채우기: npx tsx scripts/fx-rates-fetch.ts [--from 2026-08-01] (crontab 매일)
-- 적용: docker exec -i aiwork-postgres psql -U postgres -d ainews < scripts/2026-11-06-fx-rates.sql
-- 되돌리기: DROP TABLE fx_rates;

CREATE TABLE IF NOT EXISTS fx_rates (
  rate_date   date PRIMARY KEY,
  base        text NOT NULL DEFAULT 'USD',
  per_usd     jsonb NOT NULL,
  source      text NOT NULL DEFAULT 'ECB',
  fetched_at  timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON fx_rates TO ainews;
