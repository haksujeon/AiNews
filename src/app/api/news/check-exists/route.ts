import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { requireIngestToken } from '@/lib/ingest-auth';
import { n8nContentHash } from '@/lib/n8n-hash';

// POST /api/news/check-exists
// 인증: Authorization: Bearer <INGEST_TOKEN> (저장된 source_url 열거를 막기 위함)
//
// 1) 중복 확인 — 아래 키를 한 body 에 함께 보내도 된다 (결과는 합쳐서 반환):
//      { input_hashes?: string[], urls?: string[], ids?: string[] }
//    Returns: { existing: { id, source_url, content_hash }[] }
//    n8n "Filter Duplicates" 노드가 existing[].content_hash / existing[].source_url 을 읽는다.
//    input_hashes 는 n8n "Merge and Filter" 의 simpleHash(link + '_' + newsDate) 이며 서버에서 재계산해 대조한다.
//
// 2) 임베딩 유사도 — { query_embeddings: number[][], match_threshold?: number }
//    Returns: { results: { item_index, is_similar, max_similarity }[], not_implemented: true }
//    DB 에 pgvector/임베딩 컬럼이 없어 미구현. 흐름이 끊기지 않도록 전부 is_similar=false 로 응답한다.
//    n8n "Filter Non-Similar" 노드가 results[].is_similar / results[].item_index 를 읽는다.

type ExistingRow = { id: string; source_url: string | null; content_hash: string | null };

const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : [];

export async function POST(request: NextRequest) {
  const denied = requireIngestToken(request);
  if (denied) return denied;

  try {
    const body = await request.json();

    if (Array.isArray(body?.query_embeddings)) {
      const results = body.query_embeddings.map((_: unknown, i: number) => ({
        item_index: i,
        is_similar: false,
        max_similarity: null,
      }));
      return NextResponse.json({ results, not_implemented: true });
    }

    const hashes = strArray(body?.input_hashes);
    const urls = strArray(body?.urls);
    const ids = strArray(body?.ids);

    const found = new Map<string, ExistingRow>();
    const add = (r: ExistingRow) => {
      if (!found.has(r.id)) found.set(r.id, r);
    };

    if (hashes.length) {
      // 해시는 단방향이라 DB 쪽 (source_url, news_date) 로 재계산해 대조한다. 5천여 행 규모라 전수 계산 비용은 작다.
      const want = new Set(hashes);
      const { rows } = await pool.query(
        `SELECT id::text AS id, source_url,
                to_char(news_date AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS ymd
           FROM ai_news_ex
          WHERE source_url IS NOT NULL AND source_url <> '' AND news_date IS NOT NULL`
      );
      for (const r of rows as { id: string; source_url: string; ymd: string }[]) {
        const h = n8nContentHash(r.source_url, r.ymd);
        if (want.has(h)) add({ id: r.id, source_url: r.source_url, content_hash: h });
      }
    }

    if (urls.length || ids.length) {
      const { rows } = await pool.query(
        `SELECT id::text AS id, source_url,
                to_char(news_date AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS ymd
           FROM ai_news_ex
          WHERE source_url = ANY($1::text[]) OR id::text = ANY($2::text[])`,
        [urls, ids]
      );
      for (const r of rows as { id: string; source_url: string | null; ymd: string | null }[]) {
        add({
          id: r.id,
          source_url: r.source_url,
          content_hash: r.source_url && r.ymd ? n8nContentHash(r.source_url, r.ymd) : null,
        });
      }
    }

    return NextResponse.json({ existing: [...found.values()] });
  } catch (e) {
    console.error('[api/news/check-exists]', e);
    return NextResponse.json(
      { ok: false, error: 'Lookup failed' },
      { status: 500 }
    );
  }
}
