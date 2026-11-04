-- AI 인사이트 두 단계 (2026-11-04, 제안 2): 기존 ai_insights_* = 쉬운 단계, 새 열 = "자세히" 단계.
-- insight_flags: 저장 때 코드 검사 결과(한자·숫자·길이·용어). 비어 있으면 [] 대신 NULL. 밤 보정(scripts/insight-fix.ts)이 읽는다.
-- 적용: docker exec -i aiwork-postgres psql -U postgres -d ainews < scripts/2026-11-04-insight-detail.sql
-- 되돌리기: ALTER TABLE ai_news_ex DROP COLUMN ai_insights_detail_kr, DROP COLUMN ai_insights_detail_en, DROP COLUMN ai_insights_detail_cn, DROP COLUMN insight_flags, DROP COLUMN insight_version;

ALTER TABLE ai_news_ex
  ADD COLUMN IF NOT EXISTS ai_insights_detail_kr text,
  ADD COLUMN IF NOT EXISTS ai_insights_detail_en text,
  ADD COLUMN IF NOT EXISTS ai_insights_detail_cn text,
  ADD COLUMN IF NOT EXISTS insight_flags jsonb,
  ADD COLUMN IF NOT EXISTS insight_version text;

-- 밤 보정 대상 찾기 (표시가 있는 최근 기사)
CREATE INDEX IF NOT EXISTS idx_ai_news_ex_insight_flags ON ai_news_ex (created_at DESC) WHERE insight_flags IS NOT NULL;
