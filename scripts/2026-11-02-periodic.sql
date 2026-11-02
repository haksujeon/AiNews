-- 2026-11-02 주간·월간 리포트 (설계 검토서 §4)
--
-- 적용: docker exec -i aiwork-postgres psql -U postgres -d ainews -v ON_ERROR_STOP=1 < scripts/2026-11-02-periodic.sql
-- 백업: ~/backups/ainews/2026-11-02-schema-pre-periodic.sql (pg_dump --schema-only, 권한 600)
-- 되돌리기:
--   BEGIN;
--   DROP TRIGGER IF EXISTS daily_briefings_period_default ON daily_briefings;
--   DROP FUNCTION IF EXISTS daily_briefings_period_default();
--   ALTER TABLE daily_briefings DROP COLUMN metrics_id, DROP COLUMN period_start, DROP COLUMN period_end;
--   DROP TABLE period_metrics;
--   ALTER TABLE daily_briefings DROP CONSTRAINT daily_briefings_edition_type_check;
--   ALTER TABLE daily_briefings ADD CONSTRAINT daily_briefings_edition_type_check CHECK (edition_type IN ('daily','weekly'));
--   COMMIT;
--
-- 설계에서 바꾼 점
--  - daily 행의 period_start/period_end 를 채우는 BEFORE INSERT 트리거: 이 마이그레이션 뒤에도 옛 코드(운영 PM2)가
--    period 컬럼 없이 daily 행을 넣을 수 있어 NULL 이 생기지 않게 한다.
--  - edition_date = period_start 이므로 기존 UNIQUE(edition_type, edition_date, locale, version)·발행본 1개 인덱스가 그대로 유효.
BEGIN;

ALTER TABLE daily_briefings DROP CONSTRAINT IF EXISTS daily_briefings_edition_type_check;
ALTER TABLE daily_briefings ADD CONSTRAINT daily_briefings_edition_type_check
  CHECK (edition_type IN ('daily','weekly','monthly'));

ALTER TABLE daily_briefings
  ADD COLUMN IF NOT EXISTS period_start date,
  ADD COLUMN IF NOT EXISTS period_end date,
  ADD COLUMN IF NOT EXISTS metrics_id uuid;

UPDATE daily_briefings SET period_start = edition_date, period_end = edition_date
 WHERE edition_type = 'daily' AND (period_start IS NULL OR period_end IS NULL);

CREATE OR REPLACE FUNCTION daily_briefings_period_default() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.edition_type = 'daily' THEN
    NEW.period_start := COALESCE(NEW.period_start, NEW.edition_date);
    NEW.period_end := COALESCE(NEW.period_end, NEW.edition_date);
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS daily_briefings_period_default ON daily_briefings;
CREATE TRIGGER daily_briefings_period_default BEFORE INSERT ON daily_briefings
  FOR EACH ROW EXECUTE FUNCTION daily_briefings_period_default();

-- 차트는 발행본이 가리키는 스냅숏으로만 그린다 (수집 보충 뒤에도 문장과 그림이 일치)
CREATE TABLE IF NOT EXISTS period_metrics (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_type text NOT NULL CHECK (period_type IN ('weekly','monthly','custom')),
  period_start date NOT NULL,
  period_end date NOT NULL,
  baseline_start date,
  baseline_end date,
  population text NOT NULL CHECK (population IN ('ai','all')),
  metrics_version text NOT NULL,
  fingerprint text NOT NULL,
  metrics jsonb NOT NULL,
  data_quality jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (period_type, period_start, population, metrics_version, fingerprint)
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'daily_briefings_metrics_id_fkey') THEN
    ALTER TABLE daily_briefings ADD CONSTRAINT daily_briefings_metrics_id_fkey
      FOREIGN KEY (metrics_id) REFERENCES period_metrics(id);
  END IF;
END $$;

-- 주간·월간 판 찾기 (관리자 목록 유형 필터, 공개 최신판)
CREATE INDEX IF NOT EXISTS daily_briefings_period
  ON daily_briefings (edition_type, period_start DESC);

-- 앱 접속 역할(ainews). 스냅숏은 앱이 넣기만 하고 지우지 않는다.
GRANT SELECT, INSERT, UPDATE ON period_metrics TO ainews;
GRANT SELECT, INSERT, UPDATE ON daily_briefings TO ainews;

COMMIT;
