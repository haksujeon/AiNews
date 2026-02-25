const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

interface SupabaseRequestInit extends RequestInit {
  searchParams?: Record<string, string>;
}

export async function supabaseAdminFetch<T>(
  table: string,
  options: SupabaseRequestInit = {}
): Promise<T> {
  const { searchParams, ...fetchOptions } = options;

  const url = new URL(`${SUPABASE_URL}/rest/v1/${table}`);
  if (searchParams) {
    Object.entries(searchParams).forEach(([k, v]) =>
      url.searchParams.set(k, v)
    );
  }

  const res = await fetch(url.toString(), {
    ...fetchOptions,
    cache: "no-store",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(fetchOptions.headers as Record<string, string>),
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const error = Object.assign(
      new Error(`Supabase error ${res.status}: ${JSON.stringify(err)}`),
      { status: res.status, code: err?.code }
    );
    throw error;
  }

  if (res.status === 204) return undefined as T;
  return res.json();
}
