-- 브리핑 음성·카드 (2026-11-05, ~/ainews-reports/multimedia-2026-11-05/REPORT.md · INFOGRAPHIC-FORMAL.md).
-- 판(edition_date·locale)마다 종류(kind)별 한 줄. 파일은 저장소 밖(BRIEFING_MEDIA_DIR, 기본 ~/ainews-media)에 두고 path 는 그 안의 상대 경로.
-- 화면(public.ts hydrate)은 status='approved' 만 읽는다. 관리자 검토 화면은 'review' 도 보인다.
-- chapters: [{"t":24,"rank":1}] — t 초에 주요 기사 rank 가 시작. rank null = 인사·정리.
-- 적용: docker exec -i aiwork-postgres psql -U postgres -d ainews < scripts/2026-11-05-briefing-media.sql
-- 되돌리기: DROP TABLE briefing_media;

CREATE TABLE IF NOT EXISTS briefing_media (
  edition_date  date NOT NULL,
  locale        text NOT NULL CHECK (locale IN ('ko', 'en', 'zh')),
  kind          text NOT NULL CHECK (kind IN ('audio', 'card')),
  path          text NOT NULL CHECK (path !~ '\.\.' AND path !~ '^/'),
  mime          text NOT NULL,
  bytes         integer NOT NULL,
  width         integer,
  height        integer,
  duration_sec  numeric(8, 2),
  chapters      jsonb NOT NULL DEFAULT '[]'::jsonb,
  transcript    text,
  alt_text      text,
  source        text NOT NULL,
  status        text NOT NULL DEFAULT 'review' CHECK (status IN ('review', 'approved', 'rejected')),
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  approved_at   timestamptz,
  PRIMARY KEY (edition_date, locale, kind)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON briefing_media TO ainews;
