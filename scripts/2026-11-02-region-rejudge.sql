-- 2026-11-02 대상 지역 일일 재판정 기록 (n8n 분류기 n8n-v1 → 백필 방식 rejudge-rule-v1 / rejudge-llm-v1)
-- 공용 코드: src/lib/region-judge.ts (판정), src/lib/region-rejudge.ts (조건부 갱신·기록), 라우트 /api/internal/region/rejudge
--
-- 적용:     docker exec -i aiwork-postgres psql -U postgres -d ainews -v ON_ERROR_STOP=1 < scripts/2026-11-02-region-rejudge.sql
-- 되돌리기: DROP TABLE IF EXISTS region_rejudge_log, region_rejudge_runs;   (다른 테이블은 이 테이블을 참조하지 않는다)
-- 값 되돌리기(실행 하나): npx tsx --env-file=.env.local scripts/region-backfill.ts --rollback-rejudge <run_id>
--   → 기록의 new_* 가 그대로 남은 행만 old_* 로 되돌린다.
--
-- 쓰기 경로는 하나: 라우트(또는 같은 함수를 부르는 CLI) — ai_news_ex 의 지역 세 열 갱신과 기록 한 줄이 한 문장(CTE)에서 같이 들어간다.
BEGIN;

CREATE TABLE IF NOT EXISTS region_rejudge_runs (
  run_id        text        PRIMARY KEY,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  since         timestamptz NOT NULL,
  dry_run       boolean     NOT NULL DEFAULT false,
  selected      int         NOT NULL DEFAULT 0,
  by_rule       int         NOT NULL DEFAULT 0,
  by_llm        int         NOT NULL DEFAULT 0,
  changed       int         NOT NULL DEFAULT 0,   -- 대표 지역이 바뀐 행
  tags_changed  int         NOT NULL DEFAULT 0,   -- 대표 지역은 같고 태그만 바뀐 행
  failed        int         NOT NULL DEFAULT 0,   -- 규칙·LLM 모두 판정 못 함 (기존 값 유지, 다음 실행에서 다시)
  conflicts     int         NOT NULL DEFAULT 0,   -- 읽은 뒤 다른 쓰기가 바꿔 건너뛴 행
  llm_calls     int         NOT NULL DEFAULT 0,
  cost_usd      numeric(10,6) NOT NULL DEFAULT 0,
  error         text
);

CREATE TABLE IF NOT EXISTS region_rejudge_log (
  id           bigserial   PRIMARY KEY,
  run_id       text        NOT NULL,
  article_id   uuid        NOT NULL,
  stage        text        NOT NULL CHECK (stage IN ('rule','llm')),
  old_subject  text,
  old_tags     text[]      NOT NULL DEFAULT '{}',
  old_version  text,
  new_subject  text        NOT NULL,
  new_tags     text[]      NOT NULL,
  new_version  text        NOT NULL,
  changed      boolean     NOT NULL,             -- 대표 지역이 바뀜
  tags_changed boolean     NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_region_rejudge_log_created ON region_rejudge_log (created_at);
CREATE INDEX IF NOT EXISTS idx_region_rejudge_log_run ON region_rejudge_log (run_id);
CREATE INDEX IF NOT EXISTS idx_region_rejudge_log_article ON region_rejudge_log (article_id);

GRANT SELECT, INSERT, UPDATE ON region_rejudge_runs TO ainews;
GRANT SELECT, INSERT ON region_rejudge_log TO ainews;
GRANT USAGE, SELECT ON SEQUENCE region_rejudge_log_id_seq TO ainews;

COMMIT;
