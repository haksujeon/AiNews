# Frontend Architect Memory — AiNews Portal

## Project Stack
- Next.js App Router (src/app/), React 19, TypeScript strict
- Tailwind CSS v4 + shadcn/ui (New York style, lucide icons)
- Supabase REST API via direct fetch — NO Supabase SDK
- next-intl: locales ko/en/zh, defaultLocale ko
- Theme: dark-first glassmorphism, OKLCH colors, Outfit font (--font-display)

## Key File Paths
- Middleware: `src/middleware.ts` (i18n only; admin auth added in admin feature)
- Global CSS: `src/app/globals.css` (OKLCH tokens, sidebar tokens, .glass/.glass-subtle utilities)
- Supabase server helper: `src/lib/supabase.ts` (pattern: direct fetch with apikey header)
- i18n routing: `src/i18n/routing.ts`
- Messages: `messages/ko.json`, `messages/en.json`, `messages/zh.json`
- Existing shadcn/ui: badge, button, card, dialog, dropdown-menu, input, label, select, separator, sheet, skeleton, avatar

## Supabase REST Pattern (No SDK)
```typescript
const res = await fetch(`${SUPABASE_URL}/rest/v1/TABLE?${params}`, {
  headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` }
});
```
- For mutations add: `"Content-Type": "application/json"`, `Prefer: "return=representation"`
- Supabase unique constraint violations return code `23505` in error body

## Admin Management Feature
- Design doc: `docs/02-design/features/admin-management.design.md`
- Plan doc: `docs/01-plan/features/admin-management.plan.md`
- Routes: `/[locale]/admin/` (inside locale routing), `/api/admin/` (API routes)
- Auth: shared-secret password → signed httpOnly cookie `admin_session` (HMAC-SHA256 via crypto.subtle, no external deps)
- Auth helpers: `src/lib/admin-auth.ts` (signAdminToken, verifyAdminToken, requireAdminAuth)
- Subscriber schema uses `is_active boolean` (not status enum)
- Send history: aggregated from `ai_news_ex.sent_at` by 1-hour bucket in JS (no date_trunc RPC)
- Categories: all, ai-tech, ai-product, ai-biz, politics, economy, society, culture, tech (9 items)
- New shadcn to install: table, checkbox, tooltip, popover, alert-dialog, command, sonner

## i18n Convention
- Namespace keys are PascalCase (e.g., `"Admin"`, not `"admin"`)
- Use `useTranslations("Admin")` in client components, `getTranslations("Admin")` in server components
- All admin strings in `"Admin"` namespace across ko/en/zh

## Design Tokens (Dark Theme)
- Primary (cyan): `oklch(0.78 0.14 210)`
- Background: `oklch(0.11 0.02 260)`
- Sidebar bg: `oklch(0.13 0.02 260)` via `--sidebar` token
- Glassmorphism card: `bg-card/50 backdrop-blur-sm border border-border/50 rounded-xl`
