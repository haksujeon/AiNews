-- 2026-11-02 재감사 round 2 (§7-10 "3회 실패 시 대체 경로"): 제목만 판 mode 'headlines'.
-- 생성이 끝내 실패한 날(10-28·10-31 처럼)에도 판이 없지 않도록, LLM 문장 없이 기사 제목 + 원문 링크 + 매체만 싣는 draft 를 남긴다
-- (src/lib/briefing/fallback.ts headlinesEdition). 발행 여부는 리뷰어가 정한다. 늘리기만 하는 변경이라 기존 행·코드에 영향 없음.
--
--   docker exec -i aiwork-postgres psql -U postgres -d ainews < scripts/2026-11-02-briefing-headlines-mode.sql
BEGIN;
ALTER TABLE daily_briefings DROP CONSTRAINT IF EXISTS daily_briefings_mode_check;
ALTER TABLE daily_briefings ADD CONSTRAINT daily_briefings_mode_check
  CHECK (mode IN ('normal', 'short', 'skipped', 'headlines'));
COMMIT;
