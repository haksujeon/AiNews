/**
 * "지금까지의 이야기" 시범 (2026-11-04) — 주요 기사 하나에 과거 기사로 만든 흐름 두 관점(회사·주제).
 * 저장: briefing_story_context (scripts/2026-11-04-briefing-story-context.sql). 생성은 아직 스크립트(시범)뿐.
 * 읽기는 화면(public.ts hydrate)이 쓴다 — easy-terms-store.ts 와 같은 방식: 표가 없거나 읽기에 실패하면 빈 Map(판은 그대로).
 * 붙이는 규칙도 쉬운 AI 설명과 같다: 근거 기사 키(primary_ref 먼저, 그다음 refs 순)로 붙인다 (Gate 2, attachEasyTerms).
 * 연대기 근거 기사 중 지금 공개되지 않은 기사(숨김·중복)는 빼고, 근거가 모두 빠진 항목은 버린다.
 */
import pool from "@/lib/db";
import { PUBLIC_NEWS_WHERE } from "@/lib/news-query";
import type { BriefingLocale, StoryContext } from "./types";

const UNDEFINED_TABLE = "42P01";
const LENS_ORDER = { company: 0, topic: 1 } as const;

type Row = { id: string; lens: "company" | "topic"; thread_title: string; background: string; timeline: StoryContext["timeline"]; now_text: string; caution: string | null };

/** 순수: 저장 행 → 화면용, 공개 기사만 남긴다. 연대기가 2개 미만이 되면 그 관점은 뺀다 */
export function toStoryContexts(rows: Row[], visible: Set<string>): Map<string, StoryContext[]> {
  const out = new Map<string, StoryContext[]>();
  for (const r of rows) {
    const timeline = (Array.isArray(r.timeline) ? r.timeline : [])
      .map((t) => ({ ...t, refs: (t.refs ?? []).filter((x) => visible.has(x.id)) }))
      .filter((t) => t.refs.length);
    if (timeline.length < 2) continue;
    const list = out.get(r.id) ?? [];
    list.push({ lens: r.lens, title: r.thread_title, background: r.background, timeline, now: r.now_text, caution: r.caution || null });
    list.sort((a, b) => LENS_ORDER[a.lens] - LENS_ORDER[b.lens]);
    out.set(r.id, list);
  }
  return out;
}

export async function loadStoryContext(articleIds: string[], locale: BriefingLocale): Promise<Map<string, StoryContext[]>> {
  if (!articleIds.length) return new Map();
  try {
    const { rows } = await pool.query(
      `SELECT article_id::text AS id, lens, thread_title, background, timeline, now_text, caution
         FROM briefing_story_context WHERE article_id = ANY($1::uuid[]) AND locale = $2`,
      [articleIds, locale]
    );
    if (!rows.length) return new Map();
    const refIds = [...new Set((rows as Row[]).flatMap((r) => (Array.isArray(r.timeline) ? r.timeline : []).flatMap((t) => (t.refs ?? []).map((x) => x.id))))];
    const vis = await pool.query(`SELECT id::text AS id FROM ai_news_ex WHERE id = ANY($1::uuid[]) AND ${PUBLIC_NEWS_WHERE}`, [refIds]);
    return toStoryContexts(rows as Row[], new Set(vis.rows.map((r: { id: string }) => r.id)));
  } catch (e) {
    if ((e as { code?: string }).code !== UNDEFINED_TABLE) console.error("[story-context] 읽기 실패", (e as Error).message);
    return new Map();
  }
}

/** 데일리 주요 기사(primary_ref 먼저)와 주간·월간 큰 흐름(primary_ref 없음, refs 순)이 이 함수 하나로 붙인다 */
export function attachStoryContext<T extends { refs: string[]; primary_ref?: string }>(
  stories: T[],
  rows: Map<string, StoryContext[]>
): (T & { story_context?: StoryContext[] })[] {
  return stories.map((s) => {
    const key = [s.primary_ref, ...s.refs].find((r): r is string => !!r && rows.has(r));
    return key ? { ...s, story_context: rows.get(key) } : s;
  });
}
