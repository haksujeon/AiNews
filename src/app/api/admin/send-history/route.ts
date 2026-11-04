import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/admin-auth";
import { supabaseAdminFetch } from "@/lib/supabase-admin";
import pool from "@/lib/db";

/**
 * 발송 내역 = 옛 기사 메일(2~5월, ai_news_ex.sent_at 시간 묶음) + 브리핑 아침 메일(2026-11~, newsletter_sends 판 묶음).
 * 화면 모양(SendEvent)은 그대로: 브리핑 메일은 판 하나 = 한 건, 목록 = 그 판 ko 주요 기사 제목(+ 실패한 받는 사람).
 */
async function briefingSendEvents() {
  const { rows } = await pool
    .query<{ edition_date: string; email: string; status: string; error: string | null; sent_at: string | null; created_at: string }>(
      `SELECT to_char(edition_date, 'YYYY-MM-DD') AS edition_date, email, status, error, sent_at, created_at
         FROM newsletter_sends ORDER BY edition_date DESC LIMIT 2000`
    )
    .catch((e) => {
      if ((e as { code?: string }).code === "42P01") return { rows: [] }; // 표 없음
      throw e;
    });
  if (!rows.length) return [];
  const dates = [...new Set(rows.map((r) => r.edition_date))];
  const { rows: eds } = await pool.query<{ edition_date: string; stories: { rank: number; title: string }[] | null }>(
    `SELECT to_char(edition_date, 'YYYY-MM-DD') AS edition_date, content->'top_stories' AS stories
       FROM daily_briefings WHERE edition_type = 'daily' AND locale = 'ko' AND status = 'published' AND edition_date = ANY($1::date[])`,
    [dates]
  );
  const titles = new Map(eds.map((e) => [e.edition_date, e.stories ?? []]));
  return dates.map((d) => {
    const rs = rows.filter((r) => r.edition_date === d);
    const sent = rs.filter((r) => r.status === "sent");
    const first = (sent.length ? sent : rs).map((r) => r.sent_at ?? r.created_at).sort()[0];
    const stories = titles.get(d) ?? [];
    const articles = [
      ...stories.map((s) => ({ id: `${d}-${s.rank}`, title_kr: s.title, title_en: null, title_cn: null, category: null, news_date: d, send_count: null, source_name: `${d} 브리핑` })),
      ...rs
        .filter((r) => r.status !== "sent")
        .map((r) => ({ id: `${d}-${r.email}`, title_kr: `⚠ ${r.status === "failed" ? "발송 실패" : "발송 중"}: ${r.email}${r.error ? ` — ${r.error}` : ""}`, title_en: null, title_cn: null, category: null, news_date: d, send_count: null, source_name: null })),
    ];
    return { bucketTime: new Date(first).toISOString(), articleCount: stories.length, recipientCount: sent.length, articles };
  });
}

interface SentNewsRow {
  id: string;
  sent_at: string;
  sent_to: string[] | null;
  send_count: number | null;
  title_kr: string | null;
  title_en: string | null;
  title_cn: string | null;
  category: string | null;
  news_date: string | null;
  source_name: string | null;
}

const SELECT_FIELDS = [
  "id",
  "sent_at",
  "sent_to",
  "send_count",
  "title_kr",
  "title_en",
  "title_cn",
  "category",
  "news_date",
  "source_name",
].join(",");

function toBucketKey(isoStr: string): string {
  const d = new Date(isoStr);
  d.setMinutes(0, 0, 0);
  return d.toISOString();
}

export async function GET(request: NextRequest) {
  const authError = await requireAdminAuth(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);
  const offset = parseInt(searchParams.get("offset") || "0");

  try {
    const rows = await supabaseAdminFetch<SentNewsRow[]>("ai_news_ex", {
      searchParams: {
        select: SELECT_FIELDS,
        sent_at: "not.is.null",
        order: "sent_at.desc",
        limit: "500",
      },
    });

    const buckets = new Map<string, SentNewsRow[]>();
    for (const row of rows) {
      const key = toBucketKey(row.sent_at);
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(row);
    }

    const legacy = Array.from(buckets.entries()).map(
      ([bucketTime, articles]) => ({
        bucketTime,
        articleCount: articles.length,
        recipientCount: Array.isArray(articles[0]?.sent_to)
          ? articles[0].sent_to.length
          : 0,
        articles: articles.map((a) => ({
          id: a.id,
          title_kr: a.title_kr,
          title_en: a.title_en,
          title_cn: a.title_cn,
          category: a.category,
          news_date: a.news_date,
          send_count: a.send_count,
          source_name: a.source_name,
        })),
      })
    );
    const allEvents = [...(await briefingSendEvents()), ...legacy].sort((a, b) => b.bucketTime.localeCompare(a.bucketTime));
    const events = allEvents.slice(offset, offset + limit);

    return NextResponse.json({
      data: { events, total: allEvents.length },
    });
  } catch (err) {
    return NextResponse.json(
      { error: { message: (err as Error).message } },
      { status: 500 }
    );
  }
}
