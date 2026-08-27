# Admin Management — Technical Design Document

> **Feature**: Admin Management (Newsletter Send History + Subscriber CRUD)
> **Plan**: `docs/01-plan/features/admin-management.plan.md`
> **Phase**: 3 Mockup + 5 Design System + 6 UI Integration
> **Author**: Frontend Architect Agent
> **Date**: 2026-02-25
> **Status**: Draft

---

## Table of Contents

1. [Overview](#1-overview)
2. [Component Tree](#2-component-tree)
3. [File Structure](#3-file-structure)
4. [API Route Specifications](#4-api-route-specifications)
5. [Middleware Auth Flow](#5-middleware-auth-flow)
6. [Cookie Signing Strategy](#6-cookie-signing-strategy)
7. [Supabase Queries](#7-supabase-queries)
8. [shadcn/ui Components Needed](#8-shadcnui-components-needed)
9. [TypeScript Types](#9-typescript-types)
10. [Page Wireframes](#10-page-wireframes)
11. [Design Language Compliance](#11-design-language-compliance)
12. [i18n Translation Keys](#12-i18n-translation-keys)
13. [DB Migration](#13-db-migration)
14. [Implementation Order](#14-implementation-order)

---

## 1. Overview

Internal-only admin panel at `/[locale]/admin/` protected by a shared-secret password. The admin panel provides two features:

- **Send History** (`/[locale]/admin/send-history`): Read-only view of newsletter send events reconstructed from `ai_news_ex.sent_at` timestamps grouped by 1-hour bucket.
- **Subscribers** (`/[locale]/admin/subscribers`): Full CRUD for `newsletter_subscribers`, including the new `organization` field.

### Route Naming Convention

| Route | Path | Notes |
|-------|------|-------|
| Admin root | `/[locale]/admin` | Redirects to `/[locale]/admin/send-history` |
| Login | `/[locale]/admin/login` | Public within admin group |
| Send History | `/[locale]/admin/send-history` | Protected |
| Subscribers | `/[locale]/admin/subscribers` | Protected |

> **Note on ADR-3 reversal**: The admin panel lives inside `[locale]` routing (e.g., `/ko/admin/send-history`) to reuse the existing i18n middleware automatically. Auth middleware is layered on top for paths matching `/{locale}/admin` (excluding login).

---

## 2. Component Tree

### 2.1 Admin Layout Shell

```
AdminLayout (src/app/[locale]/admin/layout.tsx — Server Component)
  ├── AdminSidebar (Client Component — lg+ visible)
  │   ├── AdminSidebarLogo (link to admin root)
  │   ├── AdminNavItem × 2 (Send History, Subscribers)
  │   └── AdminSidebarFooter (back-to-site link + logout button)
  ├── AdminMobileHeader (Client Component — visible below lg)
  │   ├── AdminSidebarLogo
  │   └── Sheet trigger → AdminSidebar rendered inside Sheet
  └── {page children via <main>}
```

### 2.2 Login Page

```
AdminLoginPage (src/app/[locale]/admin/login/page.tsx — Server Component)
  └── AdminLoginForm (Client Component — "use client")
      ├── Card (glassmorphism)
      │   ├── CardHeader: logo + title
      │   ├── CardContent
      │   │   ├── Label + Input (password, type="password")
      │   │   └── error message (conditional)
      │   └── CardFooter: submit Button
      └── [form state: password, error, isLoading]
```

**Behavior:**
- On submit: `POST /api/admin/auth` with `{ password }`
- On 200: router.push(`/${locale}/admin/send-history`)
- On 401: show inline error "Incorrect password"
- No redirect loop: login page is excluded from the auth middleware check

### 2.3 Send History Page

```
SendHistoryPage (src/app/[locale]/admin/send-history/page.tsx — Server Component)
  └── SendHistoryContainer (Client Component — "use client")
      ├── SendHistoryStatsBar
      │   └── StatsCard × 3 (Total Sends, Total Recipients, Total Articles)
      ├── [expandedId: string | null state]
      └── Table (shadcn/ui)
          ├── TableHeader (Date/Time, Articles, Recipients, Actions)
          └── TableBody
              └── SendHistoryRow × N (Client Component)
                  ├── ChevronRight button (rotate on expand)
                  ├── date/time cell
                  ├── article count cell
                  ├── recipient count cell
                  └── [expanded] ArticleListPanel (collapsible)
                      └── article rows: title + category Badge + date
```

**Data Flow:**
```
SendHistoryContainer
  → useEffect → fetch('/api/admin/send-history?limit=50')
  → setState({ events, loading, error })
  → renders table or Skeleton or error
```

### 2.4 Subscribers Page

```
SubscribersPage (src/app/[locale]/admin/subscribers/page.tsx — Server Component)
  └── SubscribersContainer (Client Component — "use client")
      ├── SubscribersToolbar
      │   ├── Input (search: name/email/org, debounced 300ms)
      │   ├── Select (status filter: all/active/inactive)
      │   └── Button (+ Add Subscriber → opens SubscriberFormDialog)
      ├── Table (shadcn/ui)
      │   ├── TableHeader (Name/Org, Email, Categories, Language, Status, Actions)
      │   └── TableBody
      │       └── SubscriberTableRow × N
      │           ├── Checkbox (col 1 — reserved for bulk actions)
      │           ├── name + organization (stacked)
      │           ├── email
      │           ├── categories: Badge chips
      │           ├── language badge (KO/EN/ZH)
      │           ├── status: colored dot + label
      │           └── DropdownMenu (actions)
      │               ├── "Edit" → opens SubscriberFormDialog (edit mode)
      │               ├── "Deactivate" / "Reactivate" → PUT with is_active toggle
      │               └── "Delete" → opens DeleteConfirmDialog
      ├── SubscriberFormDialog (Dialog — add/edit mode)
      │   ├── DialogHeader: "Add Subscriber" / "Edit Subscriber"
      │   ├── form fields:
      │   │   ├── Label + Input: Name (required)
      │   │   ├── Label + Input: Organization (optional)
      │   │   ├── Label + Input: Email (required, type="email")
      │   │   ├── CategoryMultiSelect (required, min 1)
      │   │   └── Label + Select: Language (ko/en/zh)
      │   └── DialogFooter: Cancel + Save buttons
      └── DeleteConfirmDialog (AlertDialog)
          ├── shows subscriber email in message
          └── buttons: Cancel + Delete (destructive)
```

### 2.5 CategoryMultiSelect Component

```
CategoryMultiSelect (Client Component)
  Props:
    value: NewsCategory[]
    onChange: (v: NewsCategory[]) => void
    disabled?: boolean

  Structure:
    Popover
      └── PopoverTrigger: Button showing selected chips + "+N more"
      └── PopoverContent
          └── Command (cmdk via shadcn)
              ├── CommandInput (filter categories)
              └── CommandList
                  └── CommandItem × 9
                      ├── Checkbox
                      └── category label

  Logic:
    - Selecting "all" clears all individual categories and disables them
    - Deselecting last item auto-selects nothing (form validation catches min=1)
    - Category order: all, ai-tech, ai-product, ai-biz, politics, economy, society, culture, tech
```

---

## 3. File Structure

All new files to create:

```
src/
├── app/
│   ├── api/
│   │   └── admin/
│   │       ├── auth/
│   │       │   └── route.ts              # POST /api/admin/auth
│   │       ├── logout/
│   │       │   └── route.ts              # POST /api/admin/logout
│   │       ├── send-history/
│   │       │   └── route.ts              # GET /api/admin/send-history
│   │       └── subscribers/
│   │           ├── route.ts              # GET, POST /api/admin/subscribers
│   │           └── [id]/
│   │               └── route.ts          # PUT, DELETE /api/admin/subscribers/[id]
│   │
│   └── [locale]/
│       └── admin/
│           ├── layout.tsx                # AdminLayout — sidebar shell + auth guard redirect
│           ├── page.tsx                  # Redirect to /[locale]/admin/send-history
│           ├── login/
│           │   └── page.tsx              # AdminLoginPage
│           ├── send-history/
│           │   └── page.tsx              # SendHistoryPage (noindex meta)
│           └── subscribers/
│               └── page.tsx              # SubscribersPage (noindex meta)
│
├── components/
│   └── admin/
│       ├── layout/
│       │   ├── AdminSidebar.tsx          # Left nav sidebar
│       │   ├── AdminNavItem.tsx          # Single nav link item
│       │   └── AdminMobileHeader.tsx     # Top bar + Sheet trigger for mobile
│       ├── login/
│       │   └── AdminLoginForm.tsx        # Password form with error state
│       ├── send-history/
│       │   ├── SendHistoryContainer.tsx  # Data fetching + state orchestrator
│       │   ├── SendHistoryStatsBar.tsx   # 3 summary stat cards
│       │   ├── SendHistoryTable.tsx      # Table wrapper + empty/loading states
│       │   ├── SendHistoryRow.tsx        # Single row with expand toggle
│       │   └── ArticleListPanel.tsx      # Expanded article list
│       └── subscribers/
│           ├── SubscribersContainer.tsx  # Data fetching + state orchestrator
│           ├── SubscribersToolbar.tsx    # Search + filter + Add button
│           ├── SubscribersTable.tsx      # Table wrapper + empty/loading states
│           ├── SubscriberTableRow.tsx    # Single row with actions dropdown
│           ├── SubscriberFormDialog.tsx  # Add/edit Dialog
│           ├── CategoryMultiSelect.tsx   # Multi-select popover for categories
│           └── DeleteConfirmDialog.tsx   # AlertDialog for hard delete
│
└── lib/
    ├── admin-auth.ts                     # Cookie signing/verification helpers
    ├── admin-types.ts                    # Shared TypeScript types for admin
    └── supabase-admin.ts                 # Server-side Supabase fetch helper (anon key, server-only)
```

**Modified files:**
```
src/middleware.ts                         # Add admin session cookie check for /[locale]/admin paths
messages/ko.json                          # Add "Admin" namespace
messages/en.json                          # Add "Admin" namespace
messages/zh.json                          # Add "Admin" namespace
```

---

## 4. API Route Specifications

All admin API routes must validate the `admin_session` cookie before processing. A shared `requireAdminAuth(request)` helper in `src/lib/admin-auth.ts` handles this check.

### 4.1 POST /api/admin/auth

**Purpose:** Validate admin password and set signed session cookie.

**Request:**
```typescript
// Body (JSON)
{ password: string }
```

**Response (200 OK):**
```typescript
{ data: { ok: true } }
```

**Response (401 Unauthorized):**
```typescript
{ error: { message: "Invalid password" } }
```

**Response (400 Bad Request):**
```typescript
{ error: { message: "Password is required" } }
```

**Cookie set on success:**
```
Set-Cookie: admin_session=<signed_token>; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=28800
```

**Implementation sketch:**
```typescript
// src/app/api/admin/auth/route.ts
import { NextRequest, NextResponse } from "next/server";
import { signAdminToken, COOKIE_NAME, COOKIE_MAX_AGE } from "@/lib/admin-auth";

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { password } = body;

  if (!password) {
    return NextResponse.json({ error: { message: "Password is required" } }, { status: 400 });
  }

  if (password !== process.env.ADMIN_PASSWORD) {
    return NextResponse.json({ error: { message: "Invalid password" } }, { status: 401 });
  }

  const token = await signAdminToken();

  const response = NextResponse.json({ data: { ok: true } });
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });

  return response;
}
```

---

### 4.2 POST /api/admin/logout

**Purpose:** Clear the admin session cookie.

**Request:** No body needed.

**Response (200 OK):**
```typescript
{ data: { ok: true } }
```

**Cookie cleared:**
```
Set-Cookie: admin_session=; HttpOnly; Path=/; Max-Age=0
```

**Implementation sketch:**
```typescript
// src/app/api/admin/logout/route.ts
export async function POST() {
  const response = NextResponse.json({ data: { ok: true } });
  response.cookies.set(COOKIE_NAME, "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}
```

---

### 4.3 GET /api/admin/send-history

**Purpose:** Return newsletter send events aggregated from `ai_news_ex` by 1-hour bucket.

**Auth:** Requires valid `admin_session` cookie.

**Query params:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `limit` | number | 50 | Max events to return |
| `offset` | number | 0 | Pagination offset |

**Response (200 OK):**
```typescript
{
  data: {
    events: SendEvent[];
    total: number;          // total distinct buckets (for pagination display)
  }
}

interface SendEvent {
  bucketTime: string;       // ISO timestamp of bucket start (hour-truncated)
  articleCount: number;
  recipientCount: number;   // length of sent_to array from first article in bucket
  articles: {
    id: string;
    title_kr: string | null;
    title_en: string | null;
    title_cn: string | null;
    category: string | null;
    news_date: string | null;
    send_count: number | null;
    source_name: string | null;
  }[];
}
```

**Response (401):**
```typescript
{ error: { message: "Unauthorized" } }
```

**Error cases:**
- 401: Missing or invalid `admin_session` cookie
- 500: Supabase query failure

---

### 4.4 GET /api/admin/subscribers

**Purpose:** Return subscriber list with optional search/filter.

**Auth:** Requires valid `admin_session` cookie.

**Query params:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `search` | string | — | Matches name, email, or organization (case-insensitive) |
| `active` | `"true"` \| `"false"` \| `"all"` | `"all"` | Filter by is_active status |
| `limit` | number | 100 | Max rows |
| `offset` | number | 0 | Pagination offset |

**Response (200 OK):**
```typescript
{
  data: {
    subscribers: Subscriber[];
    total: number;
  }
}

interface Subscriber {
  id: string;
  created_at: string;
  name: string;
  organization: string | null;
  email: string;
  categories: string[];
  language: "ko" | "en" | "zh";
  is_active: boolean;
}
```

**Error cases:**
- 401: Unauthorized
- 500: Supabase failure

---

### 4.5 POST /api/admin/subscribers

**Purpose:** Create a new subscriber.

**Auth:** Requires valid `admin_session` cookie.

**Request body:**
```typescript
{
  name: string;             // required, non-empty
  email: string;            // required, valid email format
  categories: string[];     // required, min 1 element
  organization?: string;    // optional
  language?: "ko" | "en" | "zh";  // default: "ko"
  is_active?: boolean;      // default: true
}
```

**Response (201 Created):**
```typescript
{ data: { subscriber: Subscriber } }
```

**Response (400 Bad Request):**
```typescript
{ error: { message: "Validation failed", fields: { name?: string; email?: string; categories?: string } } }
```

**Response (409 Conflict):**
```typescript
{ error: { message: "Email already exists" } }
```

**Error cases:**
- 400: Missing required fields or invalid format
- 401: Unauthorized
- 409: Duplicate email (Supabase unique constraint violation — code `23505`)
- 500: Supabase failure

---

### 4.6 PUT /api/admin/subscribers/[id]

**Purpose:** Update an existing subscriber. All fields are optional.

**Auth:** Requires valid `admin_session` cookie.

**Route param:** `id` — UUID of the subscriber.

**Request body (all fields optional):**
```typescript
{
  name?: string;
  organization?: string | null;
  email?: string;
  categories?: string[];
  language?: "ko" | "en" | "zh";
  is_active?: boolean;
}
```

**Response (200 OK):**
```typescript
{ data: { subscriber: Subscriber } }
```

**Response (404 Not Found):**
```typescript
{ error: { message: "Subscriber not found" } }
```

**Response (409 Conflict):**
```typescript
{ error: { message: "Email already exists" } }
```

**Error cases:**
- 400: Invalid field values
- 401: Unauthorized
- 404: ID not found
- 409: Duplicate email
- 500: Supabase failure

---

### 4.7 DELETE /api/admin/subscribers/[id]

**Purpose:** Permanently delete a subscriber.

**Auth:** Requires valid `admin_session` cookie.

**Route param:** `id` — UUID of the subscriber.

**Response (200 OK):**
```typescript
{ data: { ok: true } }
```

**Response (404 Not Found):**
```typescript
{ error: { message: "Subscriber not found" } }
```

**Error cases:**
- 401: Unauthorized
- 404: ID not found
- 500: Supabase failure

---

## 5. Middleware Auth Flow

### 5.1 Modified `src/middleware.ts`

The middleware is extended to check the `admin_session` cookie for all admin page routes (but NOT for `/api/admin/` routes, which do their own auth check, and NOT for the login page itself).

```typescript
// src/middleware.ts
import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";
import { NextRequest, NextResponse } from "next/server";
import { verifyAdminToken } from "./lib/admin-auth";

const intlMiddleware = createMiddleware(routing);

// Matches /ko/admin, /en/admin, /zh/admin and sub-paths
const ADMIN_PATTERN = /^\/(?:ko|en|zh)\/admin(?:\/(?!login).*)?$/;
const ADMIN_LOGIN_PATTERN = /^\/(?:ko|en|zh)\/admin\/login$/;

export default async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Skip middleware entirely for API routes and static files
  if (
    pathname.startsWith("/api") ||
    pathname.startsWith("/_next") ||
    pathname.includes(".")
  ) {
    return;
  }

  // 2. Check admin session for protected admin pages
  //    (login page itself is excluded so users can reach it unauthenticated)
  if (ADMIN_PATTERN.test(pathname) && !ADMIN_LOGIN_PATTERN.test(pathname)) {
    const sessionCookie = request.cookies.get("admin_session")?.value;
    const isValid = sessionCookie ? await verifyAdminToken(sessionCookie) : false;

    if (!isValid) {
      // Extract locale from path (e.g., "/ko/admin/send-history" → "ko")
      const locale = pathname.split("/")[1];
      const loginUrl = new URL(`/${locale}/admin/login`, request.url);
      return NextResponse.redirect(loginUrl);
    }
  }

  // 3. Apply i18n middleware for all other routes
  return intlMiddleware(request);
}

export const config = {
  matcher: ["/((?!api|_next|.*\\..*).*)"],
};
```

### 5.2 Auth Check in API Routes

Each API route handler that requires auth calls `requireAdminAuth` as the first step:

```typescript
// Pattern used in every protected API route
import { requireAdminAuth } from "@/lib/admin-auth";

export async function GET(request: NextRequest) {
  const authError = await requireAdminAuth(request);
  if (authError) return authError;  // Returns NextResponse with 401

  // ... proceed with handler
}
```

### 5.3 Flow Diagram

```
Browser → GET /ko/admin/send-history
  └── middleware.ts
      ├── ADMIN_PATTERN matches? YES
      ├── Is login page? NO
      ├── cookie admin_session present?
      │   ├── YES → verifyAdminToken() → valid?
      │   │   ├── YES → pass through → intlMiddleware → page renders
      │   │   └── NO  → redirect → /ko/admin/login
      │   └── NO  → redirect → /ko/admin/login

Browser → GET /ko/admin/login
  └── middleware.ts
      ├── ADMIN_PATTERN matches? YES but ADMIN_LOGIN_PATTERN also matches
      ├── Skip auth check → pass through → intlMiddleware → login page renders

Browser → POST /api/admin/subscribers
  └── middleware.ts → skipped (starts with /api)
  └── route.ts handler → requireAdminAuth() → reads cookie → verifyAdminToken()
      ├── valid → proceed
      └── invalid → return 401
```

---

## 6. Cookie Signing Strategy

### 6.1 Design

No external libraries. Uses the Web Crypto API (`crypto.subtle`) available in the Next.js Edge and Node.js runtime. The `admin_session` cookie value is a signed payload:

```
Format: <payload_base64url>.<signature_base64url>

payload = base64url(JSON.stringify({ iat: <epoch_seconds>, exp: <epoch_seconds> }))
signature = HMAC-SHA256(payload, ADMIN_SECRET)
```

The `ADMIN_SECRET` env var must be a string of at least 32 characters. It is used as the HMAC key.

### 6.2 Implementation — `src/lib/admin-auth.ts`

```typescript
// src/lib/admin-auth.ts
import { NextRequest, NextResponse } from "next/server";

export const COOKIE_NAME = "admin_session";
export const COOKIE_MAX_AGE = 8 * 60 * 60; // 8 hours in seconds

// ── Helpers ──────────────────────────────────────────────────────────────────

function base64urlEncode(bytes: ArrayBuffer): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function base64urlDecode(str: string): Buffer {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(base64, "base64");
}

async function getHmacKey(): Promise<CryptoKey> {
  const secret = process.env.ADMIN_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("ADMIN_SECRET must be at least 32 characters");
  }

  const keyMaterial = new TextEncoder().encode(secret);
  return crypto.subtle.importKey(
    "raw",
    keyMaterial,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

// ── Sign ─────────────────────────────────────────────────────────────────────

export async function signAdminToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload = base64urlEncode(
    new TextEncoder().encode(
      JSON.stringify({ iat: now, exp: now + COOKIE_MAX_AGE })
    )
  );

  const key = await getHmacKey();
  const signatureBytes = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload)
  );

  const signature = base64urlEncode(signatureBytes);
  return `${payload}.${signature}`;
}

// ── Verify ────────────────────────────────────────────────────────────────────

export async function verifyAdminToken(token: string): Promise<boolean> {
  try {
    const [payload, signature] = token.split(".");
    if (!payload || !signature) return false;

    const key = await getHmacKey();
    const isValid = await crypto.subtle.verify(
      "HMAC",
      key,
      base64urlDecode(signature),
      new TextEncoder().encode(payload)
    );

    if (!isValid) return false;

    // Check expiry
    const decoded = JSON.parse(
      new TextDecoder().decode(base64urlDecode(payload))
    ) as { iat: number; exp: number };

    return Math.floor(Date.now() / 1000) < decoded.exp;
  } catch {
    return false;
  }
}

// ── Middleware helper ──────────────────────────────────────────────────────────

/**
 * Use in API route handlers. Returns a 401 NextResponse if auth fails,
 * or null if the request is authenticated.
 */
export async function requireAdminAuth(
  request: NextRequest
): Promise<NextResponse | null> {
  const token = request.cookies.get(COOKIE_NAME)?.value;
  if (!token || !(await verifyAdminToken(token))) {
    return NextResponse.json(
      { error: { message: "Unauthorized" } },
      { status: 401 }
    );
  }
  return null;
}
```

### 6.3 Environment Variables Required

| Variable | Description | Example |
|----------|-------------|---------|
| `ADMIN_PASSWORD` | The password to enter on the login page | `my-very-secret-pw-2026` |
| `ADMIN_SECRET` | HMAC signing key for the session cookie (min 32 chars) | `c8f3a1b2d4e5...` (32+ chars) |
| `NEXT_PUBLIC_SUPABASE_URL` | Already present | — |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Already present | — |

> **Security note**: `ADMIN_PASSWORD` and `ADMIN_SECRET` must never start with `NEXT_PUBLIC_`. They are server-side only and never sent to the browser.

---

## 7. Supabase Queries

The admin API routes use direct REST API calls (same pattern as `src/lib/supabase.ts`). The base helper is in `src/lib/supabase-admin.ts`.

### 7.1 `src/lib/supabase-admin.ts`

```typescript
// src/lib/supabase-admin.ts
// Server-side only — uses anon key (service role key optional for admin ops)

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
    Object.entries(searchParams).forEach(([k, v]) => url.searchParams.set(k, v));
  }

  const res = await fetch(url.toString(), {
    ...fetchOptions,
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
    throw new Error(`Supabase error ${res.status}: ${JSON.stringify(err)}`);
  }

  // DELETE with no return may be 204
  if (res.status === 204) return undefined as T;

  return res.json();
}
```

### 7.2 Send History Query

**Goal:** Fetch all `ai_news_ex` rows with `sent_at IS NOT NULL`, then group by 1-hour bucket in JavaScript (Supabase REST API does not support `date_trunc` aggregation — that requires RPC or PostgREST computed columns).

```typescript
// src/app/api/admin/send-history/route.ts — query portion

// Step 1: Fetch all sent articles (fields needed for aggregation)
const SELECT_FIELDS = [
  "id",
  "sent_at",
  "sent_to",       // array of subscriber IDs/emails
  "send_count",
  "title_kr",
  "title_en",
  "title_cn",
  "category",
  "news_date",
  "source_name",
].join(",");

const rows = await supabaseAdminFetch<AiNewsExRow[]>("ai_news_ex", {
  searchParams: {
    select: SELECT_FIELDS,
    "sent_at": "not.is.null",
    order: "sent_at.desc",
    limit: "500",           // fetch enough raw rows to cover the 50 event limit
  },
});

// Step 2: Group by 1-hour bucket in JS
function toBucketKey(isoStr: string): string {
  const d = new Date(isoStr);
  d.setMinutes(0, 0, 0);   // truncate to hour
  return d.toISOString();
}

type BucketMap = Map<string, typeof rows>;
const buckets: BucketMap = new Map();

for (const row of rows) {
  const key = toBucketKey(row.sent_at);
  if (!buckets.has(key)) buckets.set(key, []);
  buckets.get(key)!.push(row);
}

// Step 3: Convert to SendEvent array (sorted newest first)
const events = Array.from(buckets.entries())
  .sort(([a], [b]) => b.localeCompare(a))   // ISO strings sort lexicographically
  .slice(offset, offset + limit)
  .map(([bucketTime, articles]) => ({
    bucketTime,
    articleCount: articles.length,
    recipientCount: articles[0]?.sent_to?.length ?? 0,
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
  }));
```

> **Note on `sent_to` column type**: The plan states `sent_to` is an array and `recipientCount` is derived from `sent_to.length` of the first article in the bucket. If `sent_to` is stored as a JSON array or Postgres `text[]`, it should parse correctly. Verify the column type in Supabase and adjust parsing if needed.

### 7.3 Subscriber Queries

**GET all subscribers:**
```typescript
// Basic query — no filter
const subscribers = await supabaseAdminFetch<Subscriber[]>("newsletter_subscribers", {
  searchParams: {
    select: "id,created_at,name,organization,email,categories,language,is_active",
    order: "created_at.desc",
    limit: String(limit),
    offset: String(offset),
  },
});

// With is_active filter (active=true)
searchParams["is_active"] = "eq.true";   // or "eq.false"

// With search (Supabase PostgREST OR filter):
// Searches name, email, organization with ilike
searchParams["or"] = `(name.ilike.%${search}%,email.ilike.%${search}%,organization.ilike.%${search}%)`;
```

> **Combining filter + search:** When both `active` filter and `search` are present, add both params. PostgREST evaluates them as AND conditions.

**GET count (for total):**
```typescript
// Use Prefer: count=exact header + HEAD request approach
// Or fetch with limit=1 and check Content-Range response header:
const countRes = await fetch(url, {
  headers: {
    ...headers,
    Prefer: "count=exact",
    Range: "0-0",
  },
});
// Content-Range: 0-0/42  → total = 42
const contentRange = countRes.headers.get("Content-Range");
const total = parseInt(contentRange?.split("/")[1] ?? "0", 10);
```

**POST create subscriber:**
```typescript
const created = await supabaseAdminFetch<Subscriber[]>("newsletter_subscribers", {
  method: "POST",
  body: JSON.stringify({
    name,
    organization: organization ?? null,
    email,
    categories,
    language: language ?? "ko",
    is_active: is_active ?? true,
  }),
  headers: { Prefer: "return=representation" },
});
// Returns array with created row; take created[0]
```

**PUT update subscriber:**
```typescript
const updated = await supabaseAdminFetch<Subscriber[]>(`newsletter_subscribers`, {
  method: "PATCH",
  searchParams: { id: `eq.${id}` },
  body: JSON.stringify(updateFields),   // only include defined fields
  headers: { Prefer: "return=representation" },
});
// Returns array; if empty → 404
```

**DELETE subscriber:**
```typescript
await supabaseAdminFetch<void>(`newsletter_subscribers`, {
  method: "DELETE",
  searchParams: { id: `eq.${id}` },
});
// 204 No Content on success
// Verify deletion: if updated.length === 0 from a prior GET, it was already gone
```

**Duplicate email detection (409):**

Supabase returns HTTP 409 or HTTP 400 with a body containing `code: "23505"` when a unique constraint is violated. Check for this in the catch block:

```typescript
catch (error) {
  const message = (error as Error).message;
  if (message.includes("23505") || message.includes("duplicate")) {
    return NextResponse.json(
      { error: { message: "Email already exists" } },
      { status: 409 }
    );
  }
  return NextResponse.json(
    { error: { message: "Internal server error" } },
    { status: 500 }
  );
}
```

---

## 8. shadcn/ui Components Needed

### 8.1 New Components to Install

```bash
npx shadcn@latest add table
npx shadcn@latest add checkbox
npx shadcn@latest add tooltip
npx shadcn@latest add popover
npx shadcn@latest add alert-dialog
npx shadcn@latest add command
npx shadcn@latest add toast
```

| Component | File | Usage |
|-----------|------|-------|
| `table` | `src/components/ui/table.tsx` | Send history table, Subscribers table |
| `checkbox` | `src/components/ui/checkbox.tsx` | Row selection in subscribers table; category multi-select |
| `tooltip` | `src/components/ui/tooltip.tsx` | Icon-only action buttons in table rows |
| `popover` | `src/components/ui/popover.tsx` | CategoryMultiSelect trigger container |
| `alert-dialog` | `src/components/ui/alert-dialog.tsx` | Delete confirmation dialog |
| `command` | `src/components/ui/command.tsx` | Category search/filter inside CategoryMultiSelect popover |
| `toast` / `sonner` | `src/components/ui/sonner.tsx` | Success/error notifications for CRUD operations |

> **Note on toast**: shadcn/ui ships `sonner` as the toast component in New York style. Install with `npx shadcn@latest add sonner`. Add `<Toaster />` to `src/app/[locale]/admin/layout.tsx`.

### 8.2 Already Installed (Reuse)

| Component | Usage |
|-----------|-------|
| `badge` | Category chips, status indicators, language badges |
| `button` | All action buttons |
| `card` | Stats cards, login form container |
| `dialog` | Add/Edit subscriber form |
| `dropdown-menu` | Row actions (Edit / Deactivate / Delete) |
| `input` | Search field, form fields |
| `label` | Form labels |
| `select` | Language selector, status filter |
| `separator` | Sidebar visual dividers |
| `sheet` | Mobile sidebar drawer |
| `skeleton` | Loading states for tables |

---

## 9. TypeScript Types

### 9.1 `src/lib/admin-types.ts`

```typescript
// src/lib/admin-types.ts

// ── Categories ──────────────────────────────────────────────────────────────

export const NEWS_CATEGORIES = [
  "all",
  "ai-tech",
  "ai-product",
  "ai-biz",
  "politics",
  "economy",
  "society",
  "culture",
  "tech",
] as const;

export type NewsCategory = (typeof NEWS_CATEGORIES)[number];

// ── Subscriber ───────────────────────────────────────────────────────────────

export interface Subscriber {
  id: string;
  created_at: string;         // ISO timestamp
  name: string;
  organization: string | null;
  email: string;
  categories: NewsCategory[];
  language: "ko" | "en" | "zh";
  is_active: boolean;         // true = active, false = deactivated
}

export interface SubscriberCreateInput {
  name: string;
  organization?: string;
  email: string;
  categories: NewsCategory[];
  language?: "ko" | "en" | "zh";
  is_active?: boolean;
}

export type SubscriberUpdateInput = Partial<SubscriberCreateInput>;

// ── Send History ──────────────────────────────────────────────────────────────

export interface SendEvent {
  bucketTime: string;         // ISO timestamp of 1-hour bucket start
  articleCount: number;
  recipientCount: number;
  articles: SendEventArticle[];
}

export interface SendEventArticle {
  id: string;
  title_kr: string | null;
  title_en: string | null;
  title_cn: string | null;
  category: string | null;
  news_date: string | null;
  send_count: number | null;
  source_name: string | null;
}

// Raw row shape from ai_news_ex for send history query
export interface AiNewsExSentRow {
  id: string;
  sent_at: string;
  sent_to: string[] | null;   // array of recipient emails/IDs
  send_count: number | null;
  title_kr: string | null;
  title_en: string | null;
  title_cn: string | null;
  category: string | null;
  news_date: string | null;
  source_name: string | null;
}

// ── API response wrappers ─────────────────────────────────────────────────────

export interface AdminApiSuccess<T> {
  data: T;
}

export interface AdminApiError {
  error: {
    message: string;
    fields?: Record<string, string>;
  };
}

export type AdminApiResponse<T> = AdminApiSuccess<T> | AdminApiError;
```

---

## 10. Page Wireframes

### 10.1 Admin Layout (Desktop)

```
┌─────────────────────────────────────────────────────────────────────┐
│  [sidebar: 240px fixed]          [main: flex-1 p-8]                 │
│ ┌────────────────────┐     ┌───────────────────────────────────────┐ │
│ │ ⚡ AINEWS Admin     │     │ [page title]          [action button] │ │
│ │ ─────────────────  │     ├───────────────────────────────────────┤ │
│ │ ≡ Send History     │     │                                       │ │
│ │ ≡ Subscribers      │     │  [page content]                       │ │
│ │                    │     │                                       │ │
│ │ ─────────────────  │     │                                       │ │
│ │ ← Back to Site     │     │                                       │ │
│ │ [Logout]           │     │                                       │ │
│ └────────────────────┘     └───────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

### 10.2 Admin Login Page

```
┌──────────────────────────────────────────────────────────────────────┐
│                                                                      │
│              ┌─────────────────────────────────────┐                │
│              │  ⚡ AINEWS Admin                      │                │
│              │  ─────────────────────────────────── │                │
│              │  Enter admin password                 │                │
│              │                                       │                │
│              │  Password  [_______________________]  │                │
│              │                                       │                │
│              │  [error message if any]               │                │
│              │                                       │                │
│              │            [Enter Admin Area →]       │                │
│              └─────────────────────────────────────┘                │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### 10.3 Send History Page

```
Send History
─────────────────────────────────────────────────────────────────────
┌──────────┐    ┌──────────────┐    ┌────────────────┐
│ 24 Sends │    │  1,842 Recip.│    │  184 Articles  │
└──────────┘    └──────────────┘    └────────────────┘

┌──────┬──────────────────┬──────────┬────────────┐
│      │   Date / Time    │ Articles │ Recipients │
├──────┼──────────────────┼──────────┼────────────┤
│  ▶   │ 2026-02-25 09:00 │    8     │    234     │
├──────┼──────────────────┼──────────┼────────────┤
│  ▼   │ 2026-02-24 09:00 │    7     │    234     │
│      │ ── Expanded articles ──────────────────── │
│      │  [ai-tech] GPT-5 Released  2026-02-24     │
│      │  [ai-biz]  OpenAI Q4...    2026-02-24     │
│      │  ...                                      │
├──────┼──────────────────┼──────────┼────────────┤
│  ▶   │ 2026-02-23 09:00 │    5     │    233     │
└──────┴──────────────────┴──────────┴────────────┘

  Showing 1–10 of 24 events  [← Prev]  [1]  [Next →]
```

### 10.4 Subscribers Page

```
Subscriber Management
─────────────────────────────────────────────────────────────────────
[🔍 Search name, email, org...]  [Status ▼]    [+ Add Subscriber]

┌───┬─────────────────┬─────────────────┬─────────────────┬────┬──────────┬─────────┐
│ □ │  Name / Org     │     Email       │   Categories    │Lang│  Status  │ Actions │
├───┼─────────────────┼─────────────────┼─────────────────┼────┼──────────┼─────────┤
│ □ │ Kim Jisoo       │ kim@example.com │[ai-tech][ai-biz]│ KO │ ● Active │   ⋯    │
│   │ Acme Corp       │                 │                 │    │          │         │
├───┼─────────────────┼─────────────────┼─────────────────┼────┼──────────┼─────────┤
│ □ │ John Smith      │ john@example.com│ [all]           │ EN │ ● Active │   ⋯    │
│   │ —               │                 │                 │    │          │         │
├───┼─────────────────┼─────────────────┼─────────────────┼────┼──────────┼─────────┤
│ □ │ Wang Lei        │ wang@example.com│[politics][econ] │ ZH │ ○ Inact. │   ⋯    │
│   │ Beijing Tech    │                 │                 │    │          │         │
└───┴─────────────────┴─────────────────┴─────────────────┴────┴──────────┴─────────┘

Showing 1–10 of 42  [← Prev]  [1] [2] [3] [4] [5]  [Next →]
```

### 10.5 Add/Edit Subscriber Dialog

```
┌──────────────────────────────────────────────────┐
│  Add Subscriber                            [×]   │
│ ──────────────────────────────────────────────── │
│  Name *              [________________________]  │
│  Organization        [________________________]  │
│  Email *             [________________________]  │
│                                                  │
│  Categories *                                    │
│  [ai-tech ×] [ai-biz ×]   [+ Select categories] │
│  * At least one category required                │
│                                                  │
│  Language            [한국어 (KO) ▼]            │
│                                                  │
│                        [Cancel]  [Save →]        │
└──────────────────────────────────────────────────┘
```

### 10.6 Delete Confirmation Dialog

```
┌──────────────────────────────────────────────────┐
│  Delete Subscriber                               │
│ ──────────────────────────────────────────────── │
│  Are you sure you want to permanently delete     │
│  "kim@example.com"?                              │
│                                                  │
│  This action cannot be undone.                   │
│                                                  │
│                    [Cancel]  [Delete]            │
└──────────────────────────────────────────────────┘
```

---

## 11. Design Language Compliance

### 11.1 Glassmorphism Tokens

| Element | Tailwind Classes |
|---------|-----------------|
| Sidebar | `bg-sidebar border-r border-sidebar-border` |
| Page background | `bg-background` (inherits dark theme) |
| Stats cards | `bg-card/50 backdrop-blur-sm border border-border/50 rounded-xl` |
| Table container | `bg-card/30 backdrop-blur-sm border border-border/50 rounded-xl overflow-hidden` |
| Dialog | Uses shadcn default + `bg-card border-border/50` |
| Active nav item | `bg-sidebar-accent border-l-2 border-sidebar-primary text-sidebar-primary-foreground` |
| Hover nav item | `hover:bg-sidebar-accent/50 transition-colors` |

### 11.2 Status Color Palette

| Status | Tailwind / OKLCH | Usage |
|--------|-----------------|-------|
| Active | `text-[oklch(0.70_0.15_160)]` (green) | Subscriber is_active=true |
| Inactive | `text-muted-foreground` (muted) | Subscriber is_active=false |
| Sent | `text-primary` (cyan) | Send history event |

### 11.3 Typography

| Role | Classes |
|------|---------|
| Page title | `font-display text-2xl font-bold tracking-tight` |
| Section header | `font-display text-lg font-semibold` |
| Table column header | `text-xs font-medium text-muted-foreground uppercase tracking-wider` |
| Table cell | `text-sm` |
| Badge | `text-xs font-medium` |

---

## 12. i18n Translation Keys

All three locales need entries under the `"Admin"` namespace key (note: capital `A` to match next-intl namespace convention).

### 12.1 `messages/en.json` — `"Admin"` namespace

```json
"Admin": {
  "title": "Admin",
  "nav": {
    "sendHistory": "Send History",
    "subscribers": "Subscribers",
    "backToSite": "Back to Site",
    "logout": "Logout"
  },
  "login": {
    "title": "AINEWS Admin",
    "subtitle": "Enter admin password to continue",
    "passwordLabel": "Password",
    "passwordPlaceholder": "Admin password",
    "submit": "Enter Admin Area",
    "errorInvalid": "Incorrect password. Please try again.",
    "errorRequired": "Password is required."
  },
  "sendHistory": {
    "title": "Newsletter Send History",
    "statTotalSends": "Total Sends",
    "statTotalRecipients": "Total Recipients",
    "statTotalArticles": "Total Articles",
    "colDateTime": "Date / Time",
    "colArticles": "Articles",
    "colRecipients": "Recipients",
    "emptyState": "No newsletter sends found.",
    "expandAriaLabel": "Expand send event details"
  },
  "subscribers": {
    "title": "Subscriber Management",
    "addButton": "Add Subscriber",
    "searchPlaceholder": "Search by name, email, or organization...",
    "filterStatus": "Status",
    "filterAll": "All",
    "filterActive": "Active",
    "filterInactive": "Inactive",
    "colName": "Name / Org",
    "colEmail": "Email",
    "colCategories": "Categories",
    "colLanguage": "Language",
    "colStatus": "Status",
    "colActions": "Actions",
    "statusActive": "Active",
    "statusInactive": "Inactive",
    "emptyState": "No subscribers found.",
    "actionEdit": "Edit",
    "actionDeactivate": "Deactivate",
    "actionReactivate": "Reactivate",
    "actionDelete": "Delete",
    "addDialog": {
      "title": "Add Subscriber",
      "editTitle": "Edit Subscriber",
      "fieldName": "Name",
      "fieldOrg": "Organization",
      "fieldEmail": "Email",
      "fieldCategories": "Categories",
      "fieldLanguage": "Language",
      "categoriesPlaceholder": "Select categories...",
      "cancel": "Cancel",
      "save": "Save",
      "validationName": "Name is required.",
      "validationEmail": "A valid email address is required.",
      "validationCategories": "Select at least one category.",
      "errorDuplicate": "This email address already exists.",
      "successAdd": "Subscriber added successfully.",
      "successEdit": "Subscriber updated successfully."
    },
    "deleteDialog": {
      "title": "Delete Subscriber",
      "description": "Are you sure you want to permanently delete \"{email}\"? This action cannot be undone.",
      "cancel": "Cancel",
      "confirm": "Delete",
      "success": "Subscriber deleted."
    },
    "toggleSuccess": "Subscriber status updated."
  }
}
```

### 12.2 `messages/ko.json` — `"Admin"` namespace

```json
"Admin": {
  "title": "관리자",
  "nav": {
    "sendHistory": "발송 내역",
    "subscribers": "구독자 관리",
    "backToSite": "사이트로 이동",
    "logout": "로그아웃"
  },
  "login": {
    "title": "AINEWS 관리자",
    "subtitle": "계속하려면 관리자 비밀번호를 입력하세요",
    "passwordLabel": "비밀번호",
    "passwordPlaceholder": "관리자 비밀번호",
    "submit": "관리자 영역 입장",
    "errorInvalid": "비밀번호가 올바르지 않습니다. 다시 시도해 주세요.",
    "errorRequired": "비밀번호를 입력해 주세요."
  },
  "sendHistory": {
    "title": "뉴스레터 발송 내역",
    "statTotalSends": "총 발송 횟수",
    "statTotalRecipients": "총 수신자 수",
    "statTotalArticles": "총 기사 수",
    "colDateTime": "날짜 / 시간",
    "colArticles": "기사 수",
    "colRecipients": "수신자 수",
    "emptyState": "발송 내역이 없습니다.",
    "expandAriaLabel": "발송 이벤트 상세 펼치기"
  },
  "subscribers": {
    "title": "구독자 관리",
    "addButton": "구독자 추가",
    "searchPlaceholder": "이름, 이메일, 조직으로 검색...",
    "filterStatus": "상태",
    "filterAll": "전체",
    "filterActive": "활성",
    "filterInactive": "비활성",
    "colName": "이름 / 조직",
    "colEmail": "이메일",
    "colCategories": "카테고리",
    "colLanguage": "언어",
    "colStatus": "상태",
    "colActions": "작업",
    "statusActive": "활성",
    "statusInactive": "비활성",
    "emptyState": "구독자가 없습니다.",
    "actionEdit": "수정",
    "actionDeactivate": "비활성화",
    "actionReactivate": "활성화",
    "actionDelete": "삭제",
    "addDialog": {
      "title": "구독자 추가",
      "editTitle": "구독자 수정",
      "fieldName": "이름",
      "fieldOrg": "조직",
      "fieldEmail": "이메일",
      "fieldCategories": "카테고리",
      "fieldLanguage": "언어",
      "categoriesPlaceholder": "카테고리 선택...",
      "cancel": "취소",
      "save": "저장",
      "validationName": "이름을 입력해 주세요.",
      "validationEmail": "유효한 이메일 주소를 입력해 주세요.",
      "validationCategories": "카테고리를 하나 이상 선택해 주세요.",
      "errorDuplicate": "이미 등록된 이메일 주소입니다.",
      "successAdd": "구독자가 추가되었습니다.",
      "successEdit": "구독자 정보가 수정되었습니다."
    },
    "deleteDialog": {
      "title": "구독자 삭제",
      "description": "\"{email}\" 구독자를 영구적으로 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.",
      "cancel": "취소",
      "confirm": "삭제",
      "success": "구독자가 삭제되었습니다."
    },
    "toggleSuccess": "구독자 상태가 변경되었습니다."
  }
}
```

### 12.3 `messages/zh.json` — `"Admin"` namespace

```json
"Admin": {
  "title": "管理员",
  "nav": {
    "sendHistory": "发送历史",
    "subscribers": "订阅者管理",
    "backToSite": "返回网站",
    "logout": "退出登录"
  },
  "login": {
    "title": "AINEWS 管理员",
    "subtitle": "请输入管理员密码以继续",
    "passwordLabel": "密码",
    "passwordPlaceholder": "管理员密码",
    "submit": "进入管理区域",
    "errorInvalid": "密码不正确，请重试。",
    "errorRequired": "请输入密码。"
  },
  "sendHistory": {
    "title": "新闻邮件发送历史",
    "statTotalSends": "总发送次数",
    "statTotalRecipients": "总收件人数",
    "statTotalArticles": "总文章数",
    "colDateTime": "日期 / 时间",
    "colArticles": "文章数",
    "colRecipients": "收件人数",
    "emptyState": "暂无发送记录。",
    "expandAriaLabel": "展开发送事件详情"
  },
  "subscribers": {
    "title": "订阅者管理",
    "addButton": "添加订阅者",
    "searchPlaceholder": "按姓名、邮箱或组织搜索...",
    "filterStatus": "状态",
    "filterAll": "全部",
    "filterActive": "活跃",
    "filterInactive": "停用",
    "colName": "姓名 / 组织",
    "colEmail": "邮箱",
    "colCategories": "分类",
    "colLanguage": "语言",
    "colStatus": "状态",
    "colActions": "操作",
    "statusActive": "活跃",
    "statusInactive": "停用",
    "emptyState": "暂无订阅者。",
    "actionEdit": "编辑",
    "actionDeactivate": "停用",
    "actionReactivate": "启用",
    "actionDelete": "删除",
    "addDialog": {
      "title": "添加订阅者",
      "editTitle": "编辑订阅者",
      "fieldName": "姓名",
      "fieldOrg": "组织",
      "fieldEmail": "邮箱",
      "fieldCategories": "分类",
      "fieldLanguage": "语言",
      "categoriesPlaceholder": "选择分类...",
      "cancel": "取消",
      "save": "保存",
      "validationName": "请输入姓名。",
      "validationEmail": "请输入有效的电子邮件地址。",
      "validationCategories": "请至少选择一个分类。",
      "errorDuplicate": "该邮箱地址已存在。",
      "successAdd": "订阅者添加成功。",
      "successEdit": "订阅者信息更新成功。"
    },
    "deleteDialog": {
      "title": "删除订阅者",
      "description": "确定要永久删除 \"{email}\" 吗？此操作无法撤销。",
      "cancel": "取消",
      "confirm": "删除",
      "success": "订阅者已删除。"
    },
    "toggleSuccess": "订阅者状态已更新。"
  }
}
```

---

## 13. DB Migration

### 13.1 Add `organization` Column

```sql
-- Migration: 2026-02-25_add_organization_to_newsletter_subscribers.sql
-- Idempotent: uses IF NOT EXISTS
ALTER TABLE newsletter_subscribers
  ADD COLUMN IF NOT EXISTS organization text;
```

Run via: Supabase Dashboard > SQL Editor.

### 13.2 Verify `is_active` Column Exists

The plan references `is_active` (boolean). The existing design doc used a `status` enum. Confirm the actual schema has `is_active boolean NOT NULL DEFAULT true`. If the column is named differently, all references in API routes and types must be updated.

```sql
-- Check existing column names
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'newsletter_subscribers';
```

If `is_active` does not exist and `status` enum does:
```sql
ALTER TABLE newsletter_subscribers
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
```

---

## 14. Implementation Order

| Step | Task | Files |
|------|------|-------|
| 1 | Install new shadcn/ui components | — |
| 2 | Create admin types + Supabase helper | `src/lib/admin-types.ts`, `src/lib/supabase-admin.ts` |
| 3 | Implement cookie auth helpers | `src/lib/admin-auth.ts` |
| 4 | Create auth API routes | `src/app/api/admin/auth/route.ts`, `logout/route.ts` |
| 5 | Create send-history API route | `src/app/api/admin/send-history/route.ts` |
| 6 | Create subscribers API routes | `src/app/api/admin/subscribers/route.ts`, `[id]/route.ts` |
| 7 | Update middleware for admin auth | `src/middleware.ts` |
| 8 | Create admin layout + sidebar | `src/app/[locale]/admin/layout.tsx`, `AdminSidebar.tsx`, `AdminNavItem.tsx`, `AdminMobileHeader.tsx` |
| 9 | Create admin root redirect page | `src/app/[locale]/admin/page.tsx` |
| 10 | Create login page | `src/app/[locale]/admin/login/page.tsx`, `AdminLoginForm.tsx` |
| 11 | Implement Send History page | `SendHistoryContainer.tsx`, `SendHistoryStatsBar.tsx`, `SendHistoryTable.tsx`, `SendHistoryRow.tsx`, `ArticleListPanel.tsx` |
| 12 | Implement Subscribers page | `SubscribersContainer.tsx`, `SubscribersToolbar.tsx`, `SubscribersTable.tsx`, `SubscriberTableRow.tsx` |
| 13 | Implement subscriber dialogs | `SubscriberFormDialog.tsx`, `CategoryMultiSelect.tsx`, `DeleteConfirmDialog.tsx` |
| 14 | Add Toaster to admin layout | `src/app/[locale]/admin/layout.tsx` |
| 15 | Add i18n translation keys | `messages/ko.json`, `en.json`, `zh.json` |
| 16 | Run DB migration | Supabase SQL editor |
| 17 | Add noindex meta to admin pages | `send-history/page.tsx`, `subscribers/page.tsx` |

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2026-02-25 | Initial comprehensive design — component tree, API specs, auth flow, cookie signing, Supabase queries, i18n keys | Frontend Architect Agent |
