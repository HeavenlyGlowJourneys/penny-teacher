# Prep Check (private beta)

Modular website tool for AI curriculum planning review, powered by the **Planning Intelligence Engine**.

- Feature code: `src/features/prep-check/`
- Engine: `src/features/prep-check/planning-intelligence/`
- Routes: `/tools/prep-check`, `/library`, `/subject/$subjectId`, `/review`, `/config`, `/report/$reviewId`
- Access: founder allowlist until `VITE_PREP_CHECK_PUBLIC=true`
- DB: `20260803140000_prep_check.sql`, `20260803170000_prep_check_planning_intelligence.sql`, `20260803180000_prep_check_multi_grade.sql`

## Flow

Configure school / terminology / academic year / areas of responsibility → Upload any documents (single files or ZIP) into the Library or a subject dashboard → Penny classifies each document and links it into a planning graph → Review analyses relationships across the graph → Print/PDF.

## Multi-grade model

Areas of responsibility are subject × stage pairs. Each pair gets its own hierarchy: a subject root node (`stage_id` NULL) with a grade block child scoped to `(subject_id, stage_id)`. Uploads made from a subject dashboard or a scoped library view pin documents to that grade via `intended_subject_id` / `intended_stage_id`, so the AI can refine document type but cannot move a document to another grade.

Cross-grade analysis is intentionally not implemented yet; the schema (including the nullable `phase_label` on responsibilities and subject/stage columns on concept mentions) leaves room for it without a redesign.

Removable without affecting the teacher app: delete this folder, `src/routes/tools/prep-check`, and the prep_check migrations/tables.
