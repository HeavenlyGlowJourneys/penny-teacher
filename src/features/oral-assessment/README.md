# Penny Oral Assessment Tool (private beta)

Modular product for authentic oral assessments — verify that students understand the work they submitted.

- Feature code: `src/features/oral-assessment/`
- Routes: `/tools` → Oral Assessment Tool → `/tools/oral-assessment`
- Access: founder allowlist until `VITE_ORAL_ASSESSMENT_PUBLIC=true`
- DB: `supabase/migrations/20260803150000_oral_assessment.sql`
- Architecture: [`ARCHITECTURE.md`](./ARCHITECTURE.md)

## Lecturer flow

Upload → Generate → Review → Publish → **Voice viva** (TTS questions + STT answers) → Report

Student interaction is voice-first (Chrome/Edge recommended). The current question stays on screen for accessibility; transcript builds in the background.

## Removability

Delete this folder, `src/routes/tools/oral-assessment`, and the `oral_assessment_*` tables / `oral-assessment` storage bucket. Does not affect Penny Teacher or Prep Check.
