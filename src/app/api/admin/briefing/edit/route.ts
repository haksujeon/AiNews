import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/admin-auth";
import { saveEditedBriefing, type BriefingTextPatch } from "@/lib/briefing/admin";

// POST /api/admin/briefing/edit  (관리자 세션 쿠키 필요)
// body: { id: uuid (ko 판), headline?, lede?, top_stories?: [{title?, what?, why?}], dryRun?: boolean }
// 같은 validator 로 다시 검증하고, 치명 위반이 없을 때만 version+1 의 새 draft 로 저장한다.
// 422: { error: { message, issues: ValidationIssue[] } }
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const authError = await requireAdminAuth(request);
  if (authError) return authError;

  const body: unknown = await request.json().catch(() => ({}));
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const id = typeof b.id === "string" ? b.id : "";
  if (!UUID_RE.test(id)) return NextResponse.json({ error: { message: "id must be a uuid" } }, { status: 400 });

  const patch: BriefingTextPatch = {
    headline: typeof b.headline === "string" ? b.headline : undefined,
    lede: typeof b.lede === "string" ? b.lede : undefined,
    top_stories: Array.isArray(b.top_stories)
      ? b.top_stories.slice(0, 10).map((s) => {
          const o = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
          const str = (v: unknown) => (typeof v === "string" ? v : undefined);
          return { title: str(o.title), what: str(o.what), why: str(o.why) };
        })
      : undefined,
  };

  try {
    const r = await saveEditedBriefing(id, patch, { editedBy: "admin", dryRun: b.dryRun === true });
    if (!r.ok) {
      return NextResponse.json({ error: { message: r.message, issues: r.issues ?? [] } }, { status: r.status });
    }
    return NextResponse.json({
      data: { id: r.id, version: r.version, warn: r.report.warn, fatal: r.report.fatal },
    });
  } catch (e) {
    console.error("[api/admin/briefing/edit]", e);
    return NextResponse.json({ error: { message: "Save failed" } }, { status: 500 });
  }
}
