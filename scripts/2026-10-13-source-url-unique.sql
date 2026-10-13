-- 2026-10-13  ai_news_ex.source_url 중복 정리 + UNIQUE 인덱스
--
-- 배경: n8n 은 id 를 보내지 않고 upsert 가 ON CONFLICT (id) 였기 때문에 같은 기사를 재처리하면 새 행이 생겼다.
--       upsert 를 ON CONFLICT (source_url) 로 바꾸려면 source_url 에 UNIQUE 인덱스가 필요하다.
--
-- 실행 전 백업:
--   docker exec aiwork-postgres pg_dump -U postgres -d ainews -t ai_news_ex > ai_news_ex-pre-unique.sql
-- 실행:
--   docker exec -i aiwork-postgres psql -U postgres -d ainews -v ON_ERROR_STOP=1 < scripts/2026-10-13-source-url-unique.sql
--
-- 정책: 같은 source_url 그룹에서 가장 오래된 행(created_at, id 순)의 id 를 유지한다
--       (이미 배포·발송된 링크가 가리킬 가능성이 큰 쪽). 유지 행의 비어 있는 필드는
--       나머지 행 중 가장 최근 행의 값으로 채운 뒤 나머지 행을 삭제한다.
-- 2026-10-13 실행 시점 NULL/빈 source_url = 0건 → 부분 인덱스가 아닌 일반 UNIQUE 인덱스를 쓴다
--  (부분 인덱스면 ON CONFLICT (source_url) 가 술어 없이 매칭되지 않는다). NULL 끼리는 충돌하지 않는다.

BEGIN;

-- 0) 보고: NULL/빈 source_url, 쿼리스트링·끝 슬래시 정규화 시 추가 중복 그룹 수
SELECT count(*) FILTER (WHERE source_url IS NULL)  AS null_urls,
       count(*) FILTER (WHERE source_url = '')     AS empty_urls,
       count(*) FILTER (WHERE source_url ~ '[?#]') AS urls_with_query,
       count(*) FILTER (WHERE source_url ~ '/$')   AS urls_trailing_slash
  FROM ai_news_ex;

SELECT count(*) AS normalized_dup_groups
  FROM (SELECT rtrim(split_part(source_url, '?', 1), '/') AS u
          FROM ai_news_ex WHERE coalesce(source_url, '') <> ''
         GROUP BY 1 HAVING count(*) > 1) x;

-- 1) 그룹별 유지/삭제 대상
CREATE TEMP TABLE dup_map ON COMMIT DROP AS
SELECT source_url, id, created_at,
       first_value(id) OVER w AS keep_id,
       row_number()    OVER w AS rn
  FROM ai_news_ex
 WHERE coalesce(source_url, '') <> ''
   AND source_url IN (SELECT source_url FROM ai_news_ex
                       WHERE coalesce(source_url, '') <> ''
                       GROUP BY 1 HAVING count(*) > 1)
WINDOW w AS (PARTITION BY source_url ORDER BY created_at, id);

SELECT source_url, keep_id, id AS delete_id, created_at AS deleted_created_at
  FROM dup_map WHERE rn > 1 ORDER BY source_url, created_at;

-- 2) 유지 행의 빈 필드를 가장 최근 중복 행 값으로 보충
WITH donor AS (
  SELECT DISTINCT ON (d.keep_id) d.keep_id, n.*
    FROM dup_map d JOIN ai_news_ex n ON n.id = d.id
   WHERE d.rn > 1
   ORDER BY d.keep_id, n.created_at DESC
)
UPDATE ai_news_ex k SET
  title_kr       = COALESCE(NULLIF(k.title_kr, ''),       donor.title_kr),
  title_en       = COALESCE(NULLIF(k.title_en, ''),       donor.title_en),
  summary_cn     = COALESCE(NULLIF(k.summary_cn, ''),     donor.summary_cn),
  summary_kr     = COALESCE(NULLIF(k.summary_kr, ''),     donor.summary_kr),
  summary_en     = COALESCE(NULLIF(k.summary_en, ''),     donor.summary_en),
  content_cn     = COALESCE(NULLIF(k.content_cn, ''),     donor.content_cn),
  content_kr     = COALESCE(NULLIF(k.content_kr, ''),     donor.content_kr),
  content_en     = COALESCE(NULLIF(k.content_en, ''),     donor.content_en),
  ai_insights_cn = COALESCE(NULLIF(k.ai_insights_cn, ''), donor.ai_insights_cn),
  ai_insights_kr = COALESCE(NULLIF(k.ai_insights_kr, ''), donor.ai_insights_kr),
  ai_insights_en = COALESCE(NULLIF(k.ai_insights_en, ''), donor.ai_insights_en),
  key_terms      = CASE WHEN k.key_terms IS NULL OR k.key_terms = '[]'::jsonb
                        THEN donor.key_terms ELSE k.key_terms END,
  sentiment      = COALESCE(NULLIF(k.sentiment, ''),      donor.sentiment),
  category       = COALESCE(NULLIF(k.category, ''),       donor.category),
  thumbnail_url  = COALESCE(NULLIF(k.thumbnail_url, ''),  donor.thumbnail_url),
  og_image_url   = COALESCE(NULLIF(k.og_image_url, ''),   donor.og_image_url),
  country        = COALESCE(NULLIF(k.country, ''),        donor.country)
  FROM donor
 WHERE k.id = donor.keep_id;

-- 3) 중복 행 삭제 (삭제 id 출력)
DELETE FROM ai_news_ex
 WHERE id IN (SELECT id FROM dup_map WHERE rn > 1)
RETURNING id AS deleted_id, source_url;

-- 4) UNIQUE 인덱스
CREATE UNIQUE INDEX IF NOT EXISTS ai_news_ex_source_url_key ON ai_news_ex (source_url);

COMMIT;
