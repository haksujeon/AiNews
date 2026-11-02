/**
 * 브리핑 근거 기사 열 목록 — 데일리 후보(repository.ts loadCandidateArticles), 주간·월간 근거(periodic/generate.ts loadSourceText),
 * 관리자 인라인 수정 재검증(admin.ts)이 같은 SELECT 목록을 쓴다 (Gate 2). DB 를 import 하지 않는다 (단위 테스트).
 *
 * subject_region / region_tags: 중국 중심 규칙(rules.ts isChinaSubject)과 프롬프트의 기사별 지역 표시가 쓴다.
 * 열이 빠지면 판정이 조용히 예전 실체 규칙으로 돌아가므로 테스트(tests/briefing/region-china.test.ts)가 지킨다.
 */
export const SOURCE_ARTICLE_COLUMNS = `id, source_name, source_url, category,
            COALESCE(title_cn, '') AS title_cn, COALESCE(title_kr, '') AS title_kr,
            COALESCE(summary_kr, '') AS summary_kr, COALESCE(ai_insights_kr, '') AS ai_insights_kr,
            COALESCE(key_terms, '[]'::jsonb) AS key_terms,
            COALESCE(summary_cn, '') AS summary_cn, to_char((news_date AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS news_date,
            subject_region, COALESCE(region_tags, '{}'::text[]) AS region_tags`;
