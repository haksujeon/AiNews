-- 2026-11-02 대상 지역(subject region) 분류 — 선택지 D: 대표 지역 1개 + 여러 지역 태그
-- 설계: ~/ainews-reports/region-taxonomy/report.md §6 (판정 규칙 1–8). 공용 코드: src/lib/region.ts
--
-- 적용 전 백업: docker exec aiwork-postgres pg_dump -U postgres -d ainews -t ai_news_ex > ~/backups/ainews/2026-11-02-pre-region.sql
-- 적용:        docker exec -i aiwork-postgres psql -U postgres -d ainews -v ON_ERROR_STOP=1 < scripts/2026-11-02-subject-region.sql
-- 되돌리기:    BEGIN; DROP INDEX IF EXISTS idx_ai_news_ex_region_tags, idx_ai_news_ex_subject_region;
--              ALTER TABLE ai_news_ex DROP COLUMN IF EXISTS subject_region, DROP COLUMN IF EXISTS region_tags,
--                DROP COLUMN IF EXISTS region_version; COMMIT;
--
-- 사용자 결정(2026-11-02):
--  - 대만·홍콩·마카오 기사는 대표 지역 CN 으로 저장하고 태그에 'TW'(·'HK')를 남긴다 → 대표 지역에는 'TW' 를 허용하지 않는다.
--  - 공개 칩: 전체 · 중국(CN) · 미국(US) · 그 밖(CN·US 가 아닌 나머지, GLOBAL 포함). NULL(미판정)은 '전체'에서만 보인다.
--  - region_version: 판정 경로·판본 (예: rule-v1 / llm-v1 / n8n-v1). 감시 스크립트가 규칙 대 LLM 불일치를 볼 때 쓴다.
BEGIN;

ALTER TABLE ai_news_ex
  ADD COLUMN IF NOT EXISTS subject_region text,
  ADD COLUMN IF NOT EXISTS region_tags    text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS region_version text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_news_ex_subject_region_check') THEN
    ALTER TABLE ai_news_ex ADD CONSTRAINT ai_news_ex_subject_region_check
      CHECK (subject_region IN ('CN','US','KR','JP','EU','OTHER','GLOBAL'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_news_ex_region_tags_check') THEN
    -- 태그는 대표 지역 코드 + TW·HK (GLOBAL 은 태그로 쓰지 않는다)
    ALTER TABLE ai_news_ex ADD CONSTRAINT ai_news_ex_region_tags_check
      CHECK (region_tags <@ ARRAY['CN','US','KR','JP','EU','TW','HK','OTHER']::text[]);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ai_news_ex_region_tags ON ai_news_ex USING GIN (region_tags);
CREATE INDEX IF NOT EXISTS idx_ai_news_ex_subject_region ON ai_news_ex (subject_region);

-- 앱 계정(ainews)은 이미 표 단위 권한(SELECT/INSERT/UPDATE)이 있다. 새 열에도 명시해 둔다.
GRANT SELECT, INSERT (subject_region, region_tags, region_version), UPDATE (subject_region, region_tags, region_version)
  ON ai_news_ex TO ainews;

COMMIT;
