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
}

const SELECT_FIELDS =
  "id,created_at,name,organization,email,categories,language,is_active";

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

    if (search) {
      params.or = `(name.ilike.*${search}*,email.ilike.*${search}*,organization.ilike.*${search}*)`;
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
  const { name, email, categories, organization, language } = body;

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
          language: language || "ko",
          is_active: true,
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
