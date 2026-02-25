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

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAdminAuth(request);
  if (authError) return authError;

  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const updateData: Record<string, unknown> = {};
  if (body.name !== undefined) updateData.name = body.name.trim();
  if (body.email !== undefined)
    updateData.email = body.email.trim().toLowerCase();
  if (body.organization !== undefined)
    updateData.organization = body.organization?.trim() || null;
  if (body.categories !== undefined) updateData.categories = body.categories;
  if (body.language !== undefined) updateData.language = body.language;
  if (body.is_active !== undefined) updateData.is_active = body.is_active;

  if (Object.keys(updateData).length === 0) {
    return NextResponse.json(
      { error: { message: "No fields to update" } },
      { status: 400 }
    );
  }

  try {
    const result = await supabaseAdminFetch<Subscriber[]>(
      "newsletter_subscribers",
      {
        method: "PATCH",
        searchParams: { id: `eq.${id}` },
        body: JSON.stringify(updateData),
      }
    );

    if (!result || result.length === 0) {
      return NextResponse.json(
        { error: { message: "Subscriber not found" } },
        { status: 404 }
      );
    }

    return NextResponse.json({ data: { subscriber: result[0] } });
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

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authError = await requireAdminAuth(request);
  if (authError) return authError;

  const { id } = await params;

  try {
    await supabaseAdminFetch<undefined>("newsletter_subscribers", {
      method: "DELETE",
      searchParams: { id: `eq.${id}` },
    });

    return NextResponse.json({ data: { ok: true } });
  } catch (err) {
    return NextResponse.json(
      { error: { message: (err as Error).message } },
      { status: 500 }
    );
  }
}
