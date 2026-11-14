# Penny Teacher

Cursor is the development environment for this repository. Keep the existing application, stack, and deployment path. Do not rebuild the app or move it to another framework.

## Stack

TanStack Start and React 19 on Vite, Tailwind CSS, and Supabase. Production builds target Cloudflare Workers through Nitro. Gemini, Resend, and PayFast are existing integrations. Use Bun.

`vite.config.ts` loads `@lovable.dev/vite-tanstack-config`. Leave that package in place. Removing it or adding the plugins it already provides will break the build. Email routes under `src/routes/lovable/` keep those URL paths; do not rename them unless asked.

## Source

- `src/routes` — TanStack file routes, including auth, billing, cron, PayFast, and email endpoints
- `src/features` — Prep Check and Oral Assessment
- `src/components` — shared UI
- `src/lib` — shared client and server helpers
- `src/integrations/supabase` — generated Supabase clients. Do not edit those files by hand
- `supabase/migrations` — database migrations. Do not add or edit them unless asked
- `public` — static brand assets

## Commands

- `bun run dev` — local development
- `bun run typecheck` — `tsc --noEmit`
- `bun run build` — production build
- `bun run lint` — ESLint

Do not install or upgrade dependencies unless the lockfile is missing or an install is required for a requested fix. Do not commit or push unless asked. Do not deploy.

## Environment and Supabase

Copy `.env.example` to `.env` for local work. Never commit `.env`, `.dev.vars`, or real keys. Do not print secret values.

`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are required for the client. Server code also needs `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`. The service-role key is for server database access only. Scheduled routes accept `Authorization: Bearer` with `CRON_SECRET` and reject the service-role key.

The linked Supabase project ref is in `supabase/config.toml`. Do not change production Supabase settings, RLS, or auth configuration unless asked.

## Security and privacy

Do not put real learner names, records, parent details, or credentials in source, fixtures, or commits. Use the fictional examples already in the app. Public responses must not return secret values or lists of missing setting names.

## Change scope

Fix only the requested behavior. Do not refactor unrelated code, change the technology stack, or modify production Cloudflare, DNS, PayFast, Resend, or domain settings. Deployment remains `bun run build` followed by the existing Nitro/Cloudflare path documented in the README. There is no Vercel project in this repository.
