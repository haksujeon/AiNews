# Admin Management

> **Summary**: Internal admin panel for the AiNews portal providing newsletter send history visibility and subscriber CRUD management, protected by a simple shared-secret password.
>
> **Author**: Product Manager (Claude)
> **Created**: 2026-02-25
> **Last Modified**: 2026-02-25
> **Status**: Draft

---

## 1. Overview & Purpose

The AiNews portal currently has no administrative interface. Newsletter sends are tracked per-news-item in `ai_news_ex` (via `sent_at`, `sent_to`, `send_count` columns), and subscribers live in `newsletter_subscribers`. There is no way to review send history or manage subscribers without direct database access.

This feature adds a minimal but functional admin panel at `/admin` (locale-aware: `/[locale]/admin`) that lets the site operator:

1. Review a reconstructed history of newsletter send events.
2. Perform full CRUD operations on newsletter subscribers, including a new `organization` field.

The tool is **internal-only** and will be protected by a simple environment-variable-backed password rather than a full auth system, keeping scope small and implementation fast.

---

## 2. Goals

| # | Goal | Success Metric |
|---|------|----------------|
| G-1 | Operator can see every newsletter send event at a glance | Send history list renders with date, recipient count, news count |
| G-2 | Operator can drill into a send event to see which articles were sent | Detail view shows article titles and sent_at timestamp |
| G-3 | Operator can add, edit, and deactivate subscribers without DB access | Full CRUD flows work end-to-end in the UI |
| G-4 | Admin area is not publicly accessible | Unauthenticated requests to `/admin` are redirected to a login gate |
| G-5 | DB schema reflects the `organization` field for subscribers | Migration adds `organization` column; UI exposes it in forms |

---

## 3. Scope

### 3.1 In Scope

- Password-protected admin route group (`/[locale]/admin`)
- Admin login page (simple shared-secret, stored in env var)
- Session cookie to maintain admin state (httpOnly, short-lived)
- Newsletter send history list page (aggregated from `ai_news_ex`)
- Send history detail page (articles included in a send event)
- Subscriber list page with search and active/inactive filter
- Add subscriber form (name, organization, email, categories, language)
- Edit subscriber form
- Deactivate / reactivate subscriber (toggle `is_active`)
- Hard-delete subscriber (with confirmation dialog)
- DB migration: add `organization text` column to `newsletter_subscribers`
- i18n for all admin UI strings (ko / en / zh)

### 3.2 Out of Scope

- Full user-account-based authentication (Better Auth, OAuth, etc.)
- Role-based access control / multiple admin users
- Newsletter composition or sending from the admin UI
- News article management (separate feature)
- Analytics dashboards beyond send history
- Dedicated `newsletter_send_log` table (deferred — see Decision ADR-1 below)
- Email sending infrastructure

---

## 4. Key Decisions

### ADR-1: Aggregate send history from `ai_news_ex`, do NOT create a `newsletter_send_log` table

**Options considered:**

| Option | Pros | Cons |
|--------|------|------|
| A. Aggregate from `ai_news_ex` | Zero schema change, works today | Loses granularity if `sent_at` timestamps collide across distinct send runs |
| B. Add `newsletter_send_log` table | Perfect historical record going forward | Extra migration, back-fill needed, more complex |

**Decision: Option A for now.** Aggregation strategy: group `ai_news_ex` rows by `date(sent_at)` (or by a 1-hour time bucket) to reconstruct send events. If two sends happen on the same day, they will appear merged — acceptable for the current single-operator, low-frequency use case.

**Revisit trigger:** If the operator runs more than one newsletter per day, migrate to Option B.

### ADR-2: Simple shared-secret password auth, not a full auth library

A single `ADMIN_PASSWORD` env var. Login posts the password to an API route that sets a signed httpOnly session cookie (using the `ADMIN_SECRET` env var to sign). The middleware checks for the cookie on all `/admin` routes.

No `users` table, no sessions table. If the secret leaks, rotate the env var and restart.

### ADR-3: Admin route is NOT locale-prefixed in the URL

Although the project uses `[locale]` routing, the admin panel will live under `/admin` (outside the `[locale]` segment) to keep middleware logic simple and avoid locale-dependent auth checks. UI strings are still internationalized using the user's detected locale from a cookie or `Accept-Language` header.

**Update after review:** After checking the middleware (`src/middleware.ts`), `/admin` is intercepted by the i18n middleware unless explicitly excluded. The simpler path is to place admin pages inside `src/app/[locale]/admin/` (so they get locale handling for free) and add an additional middleware check for the admin session cookie on that path prefix. This keeps the codebase consistent with the existing routing pattern.

---

## 5. Functional Requirements

### 5.1 Authentication (FR-01 to FR-03)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-01 | A `/[locale]/admin/login` page shows a single password field. On submit, the page POSTs to `POST /api/admin/auth`. | Must |
| FR-02 | `POST /api/admin/auth` validates the password against `process.env.ADMIN_PASSWORD`. On success, sets a signed httpOnly cookie (`admin_session`) valid for 8 hours and redirects to `/[locale]/admin`. On failure, returns 401. | Must |
| FR-03 | Next.js middleware checks for a valid `admin_session` cookie on all paths starting with `/{locale}/admin` (excluding `/login`). Unauthenticated requests are redirected to `/{locale}/admin/login`. | Must |

### 5.2 Newsletter Send History (FR-04 to FR-07)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-04 | `GET /api/admin/send-history` queries `ai_news_ex` where `sent_at IS NOT NULL`, groups results by a 1-hour time bucket derived from `sent_at`, and returns an array of send events: `{ bucketTime, articleCount, recipientCount, articles[] }`. `recipientCount` is the length of the `sent_to` array of the first article in the bucket (all articles in one send are sent to the same list). | Must |
| FR-05 | The admin send history list page (`/[locale]/admin/send-history`) displays send events in reverse-chronological order: date/time, article count, recipient count. | Must |
| FR-06 | Clicking a send event row opens a detail view (same page or drawer) listing the article titles and their individual `send_count`. | Should |
| FR-07 | The list is paginated or limited to the most recent 50 send events. | Should |

### 5.3 Subscriber Management (FR-08 to FR-17)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-08 | `GET /api/admin/subscribers` returns all subscribers (id, email, name, organization, categories, language, is_active, created_at). Supports query params: `search` (matches name, email, or organization), `active` (true/false/all). | Must |
| FR-09 | The subscriber list page (`/[locale]/admin/subscribers`) shows a table with columns: name, organization, email, categories, language, status (active/inactive), created date. | Must |
| FR-10 | The table supports client-side search by name, email, or organization; and a filter toggle for active/inactive. | Must |
| FR-11 | `POST /api/admin/subscribers` creates a new subscriber. Required fields: name, email, categories (at least one). Optional: organization, language. Validates email uniqueness. | Must |
| FR-12 | `PUT /api/admin/subscribers/[id]` updates subscriber fields: name, organization, email, categories, language, is_active. | Must |
| FR-13 | `DELETE /api/admin/subscribers/[id]` hard-deletes a subscriber. The UI presents a confirmation dialog before calling this endpoint. | Must |
| FR-14 | The Add/Edit subscriber form includes: Name (text, required), Organization (text, optional), Email (email, required), Categories (multi-select checkbox: all, llm, tools, research, industry, policy, product, startup, other — 9 options), Language (select: ko / en / zh). | Must |
| FR-15 | Deactivate/Reactivate is a single toggle button in the subscriber row (calls `PUT /api/admin/subscribers/[id]` with `is_active` toggled). No confirmation required for deactivate; a toast confirms the action. | Should |
| FR-16 | The subscriber list shows a badge or icon indicating active vs inactive status. | Should |
| FR-17 | Adding a subscriber with a duplicate email returns a user-visible error message. | Must |

### 5.4 DB Migration (FR-18 to FR-19)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-18 | A Supabase SQL migration adds `organization text` column (nullable, no default) to `newsletter_subscribers`. | Must |
| FR-19 | The migration is idempotent (uses `IF NOT EXISTS` or equivalent). | Must |

---

## 6. Non-Functional Requirements

| ID | Requirement | Priority |
|----|-------------|----------|
| NFR-01 | Admin pages must not be indexed by search engines (add `noindex` meta tag). | Must |
| NFR-02 | All API routes under `/api/admin/` must validate the admin session cookie server-side before returning data. | Must |
| NFR-03 | The UI is responsive and usable on a desktop browser (1024px+). Mobile is not a priority. | Should |
| NFR-04 | All user-facing strings in admin pages are wrapped in `useTranslations()` / `getTranslations()` and defined in `messages/{locale}.json` under the `Admin` namespace. | Should |
| NFR-05 | API responses follow the pattern `{ data, error }`. Errors include a human-readable `message` field. | Must |
| NFR-06 | No external dependencies beyond what is already installed (shadcn/ui, next-intl, Supabase client). | Must |

---

## 7. User Stories

### Epic: Admin Access Control

**US-01 — Admin Login**
As the site operator, I want to enter a password to access the admin panel, so that casual visitors cannot view or modify subscriber data.

Acceptance Criteria:
- Navigating to `/admin` without a valid session redirects to `/admin/login`.
- Entering the correct password redirects to `/admin`.
- Entering the wrong password shows an error message and stays on the login page.
- The session expires after 8 hours.

---

### Epic: Newsletter Send History

**US-02 — View Send History**
As the site operator, I want to see a list of all newsletter send events with date, article count, and recipient count, so that I can confirm newsletters were sent successfully.

Acceptance Criteria:
- The list shows each reconstructed send event (1-hour bucket).
- Columns: Date/Time, Articles Sent, Recipients.
- Sorted newest first.
- Empty state shown if no sends have occurred.

**US-03 — Inspect Send Event Details**
As the site operator, I want to click on a send event and see which articles were included, so that I can verify newsletter content.

Acceptance Criteria:
- Clicking a row reveals article titles with their sent_at timestamp.
- I can close the detail view and return to the list.

---

### Epic: Subscriber Management

**US-04 — View All Subscribers**
As the site operator, I want to see a table of all subscribers with their key details, so that I have a clear picture of the subscriber base.

Acceptance Criteria:
- Table shows: name, organization, email, categories, language, status.
- Active and inactive subscribers are visually distinguished.

**US-05 — Search and Filter Subscribers**
As the site operator, I want to search by name, email, or organization and filter by active/inactive status, so that I can quickly find a specific subscriber.

Acceptance Criteria:
- Search is applied as I type (debounced).
- Filter options: All / Active / Inactive.

**US-06 — Add New Subscriber**
As the site operator, I want to manually add a subscriber with name, organization, email, categories, and language preference, so that I can enroll people who signed up offline.

Acceptance Criteria:
- Form validates required fields (name, email, at least one category).
- Duplicate email shows an inline error.
- On success, new subscriber appears in the list immediately.

**US-07 — Edit Subscriber**
As the site operator, I want to edit any subscriber's details, so that I can correct mistakes or update information.

Acceptance Criteria:
- Edit form pre-populates with current values.
- Saving updates the record and shows a success toast.

**US-08 — Deactivate / Reactivate Subscriber**
As the site operator, I want to deactivate a subscriber without deleting them, so that they stop receiving newsletters but I retain their record.

Acceptance Criteria:
- One-click toggle in the subscriber row.
- Status badge updates immediately (optimistic UI or refetch).
- Reactivating works the same way.

**US-09 — Delete Subscriber**
As the site operator, I want to permanently delete a subscriber after confirmation, so that I can remove invalid records.

Acceptance Criteria:
- Delete button opens a confirmation dialog with the subscriber's email shown.
- On confirm, the subscriber is removed and disappears from the list.
- On cancel, nothing changes.

---

## 8. Page & Route Map

| Page / Route | Path | Description |
|---|---|---|
| Admin Login | `/[locale]/admin/login` | Password entry form |
| Admin Home | `/[locale]/admin` | Redirect to /admin/send-history |
| Send History List | `/[locale]/admin/send-history` | Aggregated send events |
| Subscriber List | `/[locale]/admin/subscribers` | CRUD table |
| API: Auth | `POST /api/admin/auth` | Login, sets cookie |
| API: Logout | `POST /api/admin/logout` | Clears cookie |
| API: Send History | `GET /api/admin/send-history` | Returns aggregated events |
| API: Subscribers List | `GET /api/admin/subscribers` | List with search/filter |
| API: Create Subscriber | `POST /api/admin/subscribers` | Create |
| API: Update Subscriber | `PUT /api/admin/subscribers/[id]` | Update |
| API: Delete Subscriber | `DELETE /api/admin/subscribers/[id]` | Delete |

---

## 9. DB Migration

### Migration: Add `organization` to `newsletter_subscribers`

```sql
-- Migration: 2026-02-25_add_organization_to_newsletter_subscribers.sql
ALTER TABLE newsletter_subscribers
  ADD COLUMN IF NOT EXISTS organization text;
```

Run via Supabase Dashboard > SQL Editor, or via `supabase db push` if a local CLI is configured.

No existing rows are affected (column is nullable, no default).

---

## 10. Success Metrics

| Metric | Target |
|--------|--------|
| Admin login works with correct password and rejects incorrect ones | 100% |
| Send history page loads and displays aggregated events without error | All existing `sent_at`-populated rows rendered |
| Subscriber CRUD: create, read, update, delete all work end-to-end | 0 uncaught errors in normal flows |
| `organization` column present in DB and editable in UI | Confirmed via form submission |
| Unauthenticated access to `/admin` routes blocked | 100% redirect to login |

---

## 11. Risks & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `sent_at` timestamp collisions make 1-hour bucket grouping ambiguous | Low (low send frequency) | Low | Document limitation; revisit if send frequency increases |
| Shared-secret auth is weaker than proper auth | Medium | Medium | Acceptable for internal tool; rotate password periodically; add IP allowlist in Supabase if needed |
| Supabase anon key exposed in API routes | Low | High | Admin API routes run server-side only; anon key is not sent to browser |
| i18n admin strings in 3 locales adds translation overhead | Medium | Low | Provide English strings first; other locales can be machine-translated |

---

## 12. Timeline (Rough Estimate)

| Phase | Deliverable | Effort |
|-------|-------------|--------|
| Design | Technical design document, component diagram, API spec | 0.5 day |
| Do | DB migration, auth middleware, API routes, UI pages | 2 days |
| Check | Gap analysis vs design | 0.5 day |
| Act | Bug fixes and iteration | 0.5 day |
| **Total** | | **~3.5 days** |

---

## 13. Related Documents

- Design: `docs/02-design/features/admin-management.design.md` (to be created)
- Analysis: `docs/03-analysis/features/admin-management.analysis.md` (to be created)
- Report: `docs/04-report/features/admin-management.report.md` (to be created)

---

## Version History

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2026-02-25 | Initial draft | PM Agent |
