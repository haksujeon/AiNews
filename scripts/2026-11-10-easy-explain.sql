-- 기사 상세 "쉽게 풀어보기" (2026-11-10, src/lib/easy-explain.ts): 쉽게 말하면(ai_easy_*) · 왜 중요할까(ai_why_*).
-- 기존 ai_insights_* 는 그대로 둔다(브리핑 후보 입력·예전 화면). easy_flags: 저장 전 검사 결과(없으면 NULL).
-- 적용: docker exec -i aiwork-postgres psql -U postgres -d ainews < scripts/2026-11-10-easy-explain.sql
-- 되돌리기: ALTER TABLE ai_news_ex DROP COLUMN ai_easy_kr, DROP COLUMN ai_easy_en, DROP COLUMN ai_easy_cn, DROP COLUMN ai_why_kr, DROP COLUMN ai_why_en, DROP COLUMN ai_why_cn, DROP COLUMN easy_flags, DROP COLUMN easy_version;

ALTER TABLE ai_news_ex
  ADD COLUMN IF NOT EXISTS ai_easy_kr text,
  ADD COLUMN IF NOT EXISTS ai_easy_en text,
  ADD COLUMN IF NOT EXISTS ai_easy_cn text,
  ADD COLUMN IF NOT EXISTS ai_why_kr text,
  ADD COLUMN IF NOT EXISTS ai_why_en text,
  ADD COLUMN IF NOT EXISTS ai_why_cn text,
  ADD COLUMN IF NOT EXISTS easy_flags jsonb,
  ADD COLUMN IF NOT EXISTS easy_version text;
