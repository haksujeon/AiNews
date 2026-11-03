-- 2026-11-03 "쉬운 AI 설명" — 데일리 브리핑 주요 기사마다 용어 2~3개의 쉬운 한 줄 풀이 (시범: 그날 판만)
--
-- 적용: docker exec -i aiwork-postgres psql -U postgres -d ainews -v ON_ERROR_STOP=1 < scripts/2026-11-03-briefing-easy-terms.sql
-- 되돌리기: DROP TABLE IF EXISTS briefing_easy_terms;
--   (새 테이블만 만든다. 테이블이 없으면 화면은 상자를 그리지 않는다 — public.ts loadEasyTerms 가 빈 값을 준다)
--
--  - 한 행 = (기사 = 주요 기사의 primary_ref, 언어) 하나. 번역판은 refs 를 바꾸지 않으므로 ko·en·zh 판이 같은 기사 키로 찾는다.
--  - terms: [{term, pinyin, name, easy, detail}] — term·pinyin·detail 은 기사 key_terms 를 그대로 복사, name·easy 만 모델이 쓴다.
--  - 발행본(content)에 쓰지 않는다: 판의 버전·AI 검토 기록을 건드리지 않고, 지우면 상자만 사라진다.
BEGIN;

CREATE TABLE IF NOT EXISTS briefing_easy_terms (
  article_id     uuid NOT NULL,
  locale         text NOT NULL CHECK (locale IN ('ko', 'en', 'zh')),
  edition_date   date NOT NULL,
  terms          jsonb NOT NULL,
  model          text NOT NULL,
  prompt_version text NOT NULL,
  cost_usd       numeric(10, 6),
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (article_id, locale)
);

CREATE INDEX IF NOT EXISTS briefing_easy_terms_edition_idx ON briefing_easy_terms (edition_date);

GRANT SELECT, INSERT, UPDATE ON briefing_easy_terms TO ainews;

COMMIT;
