-- 2026-10-13 데일리 중국 AI 브리핑 저장 테이블 (설계 검토서 §4 기준)
--
-- 적용: docker exec -i aiwork-postgres psql -U postgres -d ainews < scripts/2026-10-13-daily-briefings.sql
-- 되돌리기: DROP TABLE daily_briefings;
--
-- 설계에서 바꾼 점
--  - status 에 'skipped'(물량 3건 미만으로 판 생략), 'superseded'(새 버전 발행으로 교체됨) 추가
--  - edition_type/edition_date/locale 별 version 은 재생성할 때마다 +1 (발행본은 절대 덮어쓰지 않음)
--  - mode: 'normal' | 'short' | 'skipped' (§1.2 물량 규칙)
--  - candidate_count: 그날 후보(전재 묶음 후) 수 — "기사 N건 중 M건 정리" 표시용
--  - ai_news_ex 에 updated_at 이 없어 input_hash 는 후보 id + 본문 지문 + prompt_version + model 로 만든다
BEGIN;

CREATE TABLE IF NOT EXISTS daily_briefings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_type text NOT NULL DEFAULT 'daily' CHECK (edition_type IN ('daily','weekly')),
  edition_date date NOT NULL,                       -- 베이징 기준 발행일 (ai_news_ex.news_date 와 같은 뜻)
  locale text NOT NULL CHECK (locale IN ('ko','en','zh')),
  version int NOT NULL DEFAULT 1,
  status text NOT NULL CHECK (status IN ('generating','draft','failed','skipped','published','superseded','withdrawn')),
  mode text NOT NULL DEFAULT 'normal' CHECK (mode IN ('normal','short','skipped')),
  schema_version int NOT NULL DEFAULT 1,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,       -- refs 는 uuid 로 되돌려 저장
  article_ids uuid[] NOT NULL DEFAULT '{}',         -- 인용한 기사 (전재 형제 포함)
  input_article_ids uuid[] NOT NULL DEFAULT '{}',   -- 후보 기사
  candidate_count int NOT NULL DEFAULT 0,
  input_hash text NOT NULL,
  validation jsonb,
  source_briefing_id uuid REFERENCES daily_briefings(id),  -- en/zh → ko
  model text,
  prompt_version text,
  llm_request_ids text[],
  input_tokens int,
  output_tokens int,
  cost_usd numeric(10,6),
  latency_ms int,
  error text,
  needs_review boolean NOT NULL DEFAULT false,
  edited_by text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  UNIQUE (edition_type, edition_date, locale, version)
);

-- 같은 판·언어에서 발행본은 하나뿐
CREATE UNIQUE INDEX IF NOT EXISTS daily_briefings_one_published
  ON daily_briefings (edition_type, edition_date, locale) WHERE status = 'published';

-- 공개 목록(최신 판, 아카이브)
CREATE INDEX IF NOT EXISTS daily_briefings_list
  ON daily_briefings (locale, edition_type, edition_date DESC) WHERE status = 'published';

-- 기사 숨김 → 해당 기사를 인용한 판 찾기 (article_ids @> ARRAY[id])
CREATE INDEX IF NOT EXISTS daily_briefings_article_ids
  ON daily_briefings USING gin (article_ids);

COMMIT;
