-- "지금까지의 이야기" 시범 (2026-11-04, ~/ainews-reports/insight-easy-2026-11/STORY-RAG.md).
-- 브리핑 주요 기사의 근거 기사(article_id)마다 관점(lens) 두 개: company(같은 회사의 같은 종류 일) / topic(다른 회사의 같은 주제).
-- timeline: [{"date":"YYYY-MM-DD","text":"…","refs":[{"id":"uuid","source":"36Kr","title":"…"}]}]
-- 화면(public.ts hydrate)이 읽는다. 표가 없으면 상자만 없다.
-- 적용: docker exec -i aiwork-postgres psql -U postgres -d ainews < scripts/2026-11-04-briefing-story-context.sql
-- 되돌리기: DROP TABLE briefing_story_context;

CREATE TABLE IF NOT EXISTS briefing_story_context (
  article_id    uuid NOT NULL,
  lens          text NOT NULL CHECK (lens IN ('company', 'topic')),
  locale        text NOT NULL CHECK (locale IN ('ko', 'en', 'zh')),
  edition_date  date NOT NULL,
  thread_title  text NOT NULL,
  background    text NOT NULL,
  timeline      jsonb NOT NULL,
  now_text      text NOT NULL,
  caution       text,
  status        text NOT NULL DEFAULT 'sample',
  model         text,
  prompt_version text,
  cost_usd      numeric(10, 6),
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (article_id, lens, locale)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON briefing_story_context TO ainews;
