import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/admin-auth";
import { supabaseAdminFetch } from "@/lib/supabase-admin";

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

    const allEvents = Array.from(buckets.entries()).sort(([a], [b]) =>
      b.localeCompare(a)
    );

    const events = allEvents.slice(offset, offset + limit).map(
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
