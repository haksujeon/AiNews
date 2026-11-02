-- 2026-11-02 브리핑 정정 기록용 컬럼 (P0-1 발행 운영, P0-6 정정 기록이 읽는다)
--
-- 적용: docker exec -i aiwork-postgres psql -U postgres -d ainews -v ON_ERROR_STOP=1 < scripts/2026-11-02-briefing-corrections.sql
-- 백업: docker exec aiwork-postgres pg_dump -U postgres -d ainews -t daily_briefings > ~/backups/ainews/2026-11-02-pre-corrections.sql (권한 600)
-- 되돌리기:
--   BEGIN;
--   DROP TRIGGER IF EXISTS daily_briefings_status_changed ON daily_briefings;
--   DROP FUNCTION IF EXISTS daily_briefings_status_changed();
--   ALTER TABLE daily_briefings DROP COLUMN IF EXISTS public_note, DROP COLUMN IF EXISTS status_changed_at;
--   COMMIT;
--
--  - public_note: 철회 사유 등 독자에게 공개하는 정정 메모 (철회는 사유 필수 — /api/admin/briefing/publish)
--  - status_changed_at: 상태가 바뀐 시각. 트리거가 채운다 → 새 코드·옛 코드(운영 PM2)·SQL 직접 수정 모두 같은 규칙.
--    기존 행은 updated_at 으로 채운다(가장 가까운 근사치).
--  - 출시 전 시험 데이터는 정정 기록에서 뺀다: 정정 기록(P0-6)은 첫 정식 발행일(cutoff, 결정 D6) 이후만 조회한다.
BEGIN;

ALTER TABLE daily_briefings
  ADD COLUMN IF NOT EXISTS public_note text,
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;

UPDATE daily_briefings SET status_changed_at = updated_at WHERE status_changed_at IS NULL;

ALTER TABLE daily_briefings ALTER COLUMN status_changed_at SET DEFAULT now();

CREATE OR REPLACE FUNCTION daily_briefings_status_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.status_changed_at := COALESCE(NEW.status_changed_at, now());
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS daily_briefings_status_changed ON daily_briefings;
CREATE TRIGGER daily_briefings_status_changed BEFORE INSERT OR UPDATE ON daily_briefings
  FOR EACH ROW EXECUTE FUNCTION daily_briefings_status_changed();

-- 기존 권한 유지 확인 (테이블 단위 권한이라 새 컬럼도 포함된다)
GRANT SELECT, INSERT, UPDATE ON daily_briefings TO ainews;

COMMIT;
