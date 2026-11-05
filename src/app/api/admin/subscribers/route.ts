import { NextRequest, NextResponse } from "next/server";
import { requireAdminAuth } from "@/lib/admin-auth";
import { supabaseAdminFetch } from "@/lib/supabase-admin";

interface Subscriber {
  id: string;
  created_at: string;
  name: string;
  organization: string | null;
  email: string;
  categories: string[];
  language: string;
  is_active: boolean;
  job_title: string | null;
  source: string | null;
  confirmed_at: string | null;
  unsubscribed_at: string | null;
}

const SELECT_FIELDS =
  "id,created_at,name,organization,email,categories,language,is_active,job_title,source,confirmed_at,unsubscribed_at";

export async function GET(request: NextRequest) {
  const authError = await requireAdminAuth(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search") || "";
  const active = searchParams.get("active") || "all";

  try {
    const params: Record<string, string> = {
      select: SELECT_FIELDS,
      order: "created_at.desc",
    };

    if (active === "true") params.is_active = "eq.true";
    else if (active === "false") params.is_active = "eq.false";
    else if (active === "pending") {
      // 확인 대기 = 아직 확인 메일을 누르지 않은 신청 (scripts/2026-11-05-newsletter-signup.sql)
      params.is_active = "eq.false";
      params.confirmed_at = "is.null";
      params.unsubscribed_at = "is.null";
    }

    // 검색어는 조회 조건 문법 글자(쉼표·괄호·별표·점·콜론·따옴표·역슬래시)를 빼고 넣는다 — 조건을 바꿔 끼우지 못하게
    const q = search.replace(/[,()*.:"\\]/g, " ").trim().slice(0, 60);
    if (q) {
      params.or = `(name.ilike.*${q}*,email.ilike.*${q}*,organization.ilike.*${q}*,job_title.ilike.*${q}*)`;
    }

    const subscribers = await supabaseAdminFetch<Subscriber[]>(
      "newsletter_subscribers",
      { searchParams: params }
    );

    return NextResponse.json({
      data: { subscribers, total: subscribers.length },
    });
  } catch (err) {
    return NextResponse.json(
      { error: { message: (err as Error).message } },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const authError = await requireAdminAuth(request);
  if (authError) return authError;

  const body = await request.json().catch(() => ({}));
  const { name, email, categories, organization, language, job_title } = body;

  const errors: Record<string, string> = {};
  if (!name?.trim()) errors.name = "Name is required";
  if (!email?.trim()) errors.email = "Email is required";
  if (!categories || !Array.isArray(categories) || categories.length === 0) {
    errors.categories = "At least one category is required";
  }

  if (Object.keys(errors).length > 0) {
    return NextResponse.json(
      { error: { message: "Validation failed", fields: errors } },
      { status: 400 }
    );
  }

  try {
    const result = await supabaseAdminFetch<Subscriber[]>(
      "newsletter_subscribers",
      {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim().toLowerCase(),
          categories,
          organization: organization?.trim() || null,
          job_title: typeof job_title === "string" ? job_title.trim() || null : null,
          language: language || "ko",
          is_active: true,
          // 관리자가 직접 넣은 구독자는 확인된 것으로 본다
          confirmed_at: new Date().toISOString(),
        }),
      }
    );

    return NextResponse.json(
      { data: { subscriber: result[0] } },
      { status: 201 }
    );
  } catch (err) {
    const error = err as Record<string, unknown>;
    if (error.code === "23505") {
      return NextResponse.json(
        { error: { message: "Email already exists" } },
        { status: 409 }
      );
    }
    return NextResponse.json(
      { error: { message: (err as Error).message } },
      { status: 500 }
    );
  }
}
