-- 히스토리 분석 자동 생성 기록 (2026-11-04, src/lib/briefing/story-run.ts). ko 데일리 판 하나당 끝까지 간 시도 1행.
-- 오류가 난 시도는 남기지 않는다 → 다음 cron 이 빠진 관점만 다시 만든다. briefing_easy_runs 와 같은 모양.
-- 적용: docker exec -i aiwork-postgres psql -U postgres -d ainews < scripts/2026-11-04-briefing-story-runs.sql
-- 되돌리기: DROP TABLE briefing_story_runs;
CREATE TABLE IF NOT EXISTS briefing_story_runs (
  briefing_id  uuid PRIMARY KEY,
  edition_date date NOT NULL,
  result       jsonb NOT NULL,
  cost_usd     numeric(10, 6),
  created_at   timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON briefing_story_runs TO ainews;
