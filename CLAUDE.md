# CLAUDE.md - Project Context for Claude Code

## Project Overview
Next.js SaaS starter template with authentication, team management, and i18n.

## Tech Stack
- **Framework**: Next.js 15 (App Router, `src/` directory)
- **Auth**: Better Auth (email/password, social login, organization plugin)
- **Database**: PostgreSQL + Drizzle ORM
- **i18n**: next-intl (ko, en, zh) with `[locale]` route segment
- **UI**: shadcn/ui + Tailwind CSS v4
- **Language**: TypeScript (strict mode)

## Key Patterns
- All pages under `src/app/[locale]/` for i18n routing
- Auth pages in `(auth)` route group (public)
- Dashboard pages in `(dashboard)` route group (protected via `requireAuth()`)
- Server-side auth helpers in `src/lib/auth-helpers.ts`
- Client-side auth hooks from `src/lib/auth-client.ts`
- Translation files in `messages/{locale}.json`
- API routes (e.g., `/api/auth`) are NOT wrapped with i18n middleware

## Commands
- `npm run dev` - Development server
- `npm run build` - Production build
- `npx drizzle-kit push` - Push schema to database
- `npx drizzle-kit generate` - Generate migrations
- `docker compose up -d postgres` - Start PostgreSQL

## Conventions
- Use `useTranslations()` for all user-facing text
- Use `cn()` from `@/lib/utils` for conditional class names
- shadcn/ui components in `src/components/ui/`
- Custom components in `src/components/{feature}/`
- Server components by default, `"use client"` only when needed
