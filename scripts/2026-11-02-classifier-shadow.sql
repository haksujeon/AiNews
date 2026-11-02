-- 2026-11-02 로봇 범위 1단계: 그림자 분류 기록 (운영 분류기 판정 vs v3 판정)
--
-- 적용: docker exec -i aiwork-postgres psql -U postgres -d ainews -v ON_ERROR_STOP=1 < scripts/2026-11-02-classifier-shadow.sql
-- 되돌리기: DROP TABLE IF EXISTS classifier_shadow;   (다른 테이블은 이 테이블을 참조하지 않는다)
--
-- 쓰기 경로는 하나: n8n "Save Shadow" → POST /api/internal/classifier-shadow (INGEST_TOKEN). n8n 에서 DB 로 바로 쓰지 않는다.
-- 운영 판정(current_*)은 n8n 'AI Relevance Classifier' 응답을 'Apply AI Filter' 와 같은 규칙으로 다시 읽은 값이다.
--  - current_relevant/current_category: 분류기 판정(없으면 NULL = 분류기 누락 → 키워드 대체 경로)
--  - current_kept: 운영에서 저장 대상(상한 안)으로 남았는지, current_capped: AI 판정이었지만 상한에 잘렸는지
--  - 최종 저장 분류는 ai_news_ex.source_url = item_url 로 조인해서 본다(Parse Translation 이 ai-biz 로 강제하는 경우 등).
BEGIN;

CREATE TABLE IF NOT EXISTS classifier_shadow (
  id               bigserial PRIMARY KEY,
  run_id           text        NOT NULL,           -- n8n execution id
  item_url         text        NOT NULL,           -- 원문 링크 (ai_news_ex.source_url 과 같은 값)
  title            text,
  source_name      text,
  current_relevant boolean,
  current_category text,
  current_subject  text,
  current_kept     boolean,
  current_capped   boolean,
  v3_relevant      boolean,
  v3_category      text,
  v3_subject       text,
  current_mode     text,                            -- llm | llm-partial | keyword-fallback (호출 단위)
  v3_mode          text,
  prompt_version   text        NOT NULL DEFAULT 'v3',
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, item_url)
);

CREATE INDEX IF NOT EXISTS classifier_shadow_created_at_idx ON classifier_shadow (created_at);
CREATE INDEX IF NOT EXISTS classifier_shadow_item_url_idx ON classifier_shadow (item_url);

-- 앱 계정(ainews)은 쓰기·읽기만. 지우기·고치기는 운영자(postgres)가 한다.
GRANT SELECT, INSERT ON classifier_shadow TO ainews;
GRANT USAGE ON SEQUENCE classifier_shadow_id_seq TO ainews;

COMMIT;
