# vibe-starter-webpack

Next.js SaaS Starter Template with Better Auth, Drizzle ORM, and next-intl.

## Stack

- **Framework**: Next.js 15 (App Router)
- **Auth**: Better Auth (email/password, social login, organization)
- **Database**: PostgreSQL + Drizzle ORM
- **i18n**: next-intl (ko, en, zh)
- **UI**: shadcn/ui + Tailwind CSS
- **Language**: TypeScript

## Quick Start

```bash
# 1. Clone
git clone https://github.com/haksujeon77/vibe-starter-webpack.git my-saas
cd my-saas

# 2. Install dependencies
npm install

# 3. Set up environment
cp .env.example .env.local
# Edit .env.local with your database URL and secrets

# 4. Start PostgreSQL (Docker)
docker compose up -d postgres

# 5. Push database schema
npx drizzle-kit push

# 6. Run dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) - you'll be redirected to `/ko`.

## Project Structure

```
src/
├── app/
│   ├── api/auth/[...all]/   # Better Auth API handler
│   └── [locale]/
│       ├── (auth)/           # Sign in / Sign up pages
│       └── (dashboard)/      # Protected dashboard pages
├── components/
│   ├── auth/                 # Auth forms, user button
│   ├── layout/               # Header, sidebar, language switcher
│   ├── team/                 # Team management components
│   └── ui/                   # shadcn/ui components
├── i18n/                     # next-intl config
└── lib/
    ├── db/                   # Drizzle DB instance & schema
    ├── auth.ts               # Better Auth server config
    ├── auth-client.ts        # Better Auth client hooks
    └── auth-helpers.ts       # Server-side auth helpers

messages/                     # Translation files (ko, en, zh)
```

## Features

- Email/password authentication
- Google & GitHub social login (optional)
- Organization/team management
- Member invitation with role-based access
- i18n with Korean, English, Chinese
- Responsive dashboard layout with sidebar
- Dark mode ready (shadcn/ui)

## Environment Variables

See `.env.example` for all required variables.

## License

MIT
