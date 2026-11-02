-- 2026-11-02 AI 편집 검토 기록 (결정 D8 변경: 관리자 필수 검토 → 별도 모델의 AI 검토 + 통과 시 자동 발행)
--
-- 적용: docker exec -i aiwork-postgres psql -U postgres -d ainews -v ON_ERROR_STOP=1 < scripts/2026-11-02-briefing-reviews.sql
-- 백업: docker exec aiwork-postgres pg_dump -U postgres -d ainews --schema-only > ~/backups/ainews/2026-11-02-schema-pre-reviews.sql (권한 600)
--       (새 테이블만 만들고 기존 테이블은 바꾸지 않는다)
-- 되돌리기:
--   DROP TABLE IF EXISTS briefing_reviews;
--
--  - 한 행 = 판 한 버전(briefing_id)에 대한 검토 1회. 수정 루프(round 1~2)는 새 버전 행을 만들고 그 버전을 다시 검토한다.
--  - trigger: pipeline(n8n 정기) | manual(관리자 다시 검토) | calibration(보정) | dry_run(결정만, 발행 안 함)
--  - decision: 자동 발행 판정 기록 (정책 값·조건별 통과 여부·실행 결과). 관리자 상세 화면의 "자동 발행 판정"이 읽는다.
BEGIN;

CREATE TABLE IF NOT EXISTS briefing_reviews (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  briefing_id      uuid NOT NULL REFERENCES daily_briefings(id) ON DELETE CASCADE,
  version          integer NOT NULL,
  edition_type     text NOT NULL,
  edition_date     date NOT NULL,
  round            integer NOT NULL DEFAULT 0,
  trigger          text NOT NULL DEFAULT 'pipeline' CHECK (trigger IN ('pipeline', 'manual', 'calibration', 'dry_run')),
  model            text NOT NULL,
  prompt_version   text NOT NULL,
  status           text NOT NULL DEFAULT 'done' CHECK (status IN ('done', 'error')),
  verdict          text CHECK (verdict IN ('PASS', 'FIXABLE', 'FAIL')),
  llm_verdict      text,
  score            numeric(3, 1),
  counts           jsonb,
  claims           jsonb,
  fixes            jsonb,
  omissions        jsonb,
  translation      jsonb,
  structure        jsonb,
  summary          text,
  decision         jsonb,
  parent_review_id uuid REFERENCES briefing_reviews(id) ON DELETE SET NULL,
  fixed_briefing_id uuid REFERENCES daily_briefings(id) ON DELETE SET NULL,
  llm_request_ids  text[],
  input_tokens     integer,
  output_tokens    integer,
  cost_usd         numeric(10, 6),
  latency_ms       integer,
  error            text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS briefing_reviews_briefing_idx ON briefing_reviews (briefing_id, created_at DESC);
CREATE INDEX IF NOT EXISTS briefing_reviews_edition_idx ON briefing_reviews (edition_type, edition_date, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON briefing_reviews TO ainews;

COMMIT;
