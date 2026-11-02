-- 2026-11-02 관련 기사 v2 미리 계산 표 (src/lib/related.ts)
--
-- 백업: docker exec aiwork-postgres pg_dump -U postgres -d ainews --schema-only -t ai_news_ex > ~/backups/ainews/2026-11-02-pre-related.sql
--       chmod 600 ~/backups/ainews/2026-11-02-pre-related.sql
-- 적용: docker exec -i aiwork-postgres psql -U postgres -d ainews -v ON_ERROR_STOP=1 < scripts/2026-11-02-related-articles.sql
-- 채우기: npx tsx --env-file=.env.local scripts/related-backfill.ts --days 60   (비어 있어도 화면은 그 자리에서 계산해 채운다)
-- 되돌리기: DROP TABLE related_articles;   (ai_news_ex 는 건드리지 않는다)
--
-- 행 = (기준 기사, 관련 기사, 묶음, 점수). 묶음: same_event(같은 사건 다른 매체) / flow(관련 흐름·후속) / company(같은 기업 소식).
-- 계산 표시 행: related_id = news_id, section = '_meta' — 관련 기사가 0건이어도 "계산했음"과 계산 시각을 남긴다.
-- ai_news_ex 로 외래 키를 걸지 않는다: 수집(upsert)이 쓰는 큰 표에 잠금·검사 부담을 주지 않기 위해. 지워진 기사는 읽을 때 JOIN 에서 빠진다.
BEGIN;

CREATE TABLE IF NOT EXISTS related_articles (
  news_id     uuid        NOT NULL,
  related_id  uuid        NOT NULL,
  section     text        NOT NULL CHECK (section IN ('same_event', 'flow', 'company', '_meta')),
  score       real        NOT NULL DEFAULT 0,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (news_id, related_id)
);

-- 어떤 기사가 남의 관련 기사로 쓰였는지 (숨김·삭제 뒤 정리, 무효화용)
CREATE INDEX IF NOT EXISTS related_articles_related_id_idx ON related_articles (related_id);
-- 오래된 계산 찾기 (백필 --stale)
CREATE INDEX IF NOT EXISTS related_articles_meta_computed_idx ON related_articles (computed_at) WHERE section = '_meta';

GRANT SELECT, INSERT, UPDATE, DELETE ON related_articles TO ainews;

COMMIT;
