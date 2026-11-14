# Oral Assessment — Architecture (Sprint 0)

## Mission

The easiest way for an educator to turn an existing written assessment into an authentic oral assessment — **without increasing workload**.

Every feature must answer: *Does this reduce educator workload while improving assessment quality?*

## Platform placement

```
Penny Platform
├── Penny Teacher          (mark capture / classes — untouched)
├── Prep Check             (modular tool)
├── Oral Assessment Tool   (this module)
└── Shared services        (auth, accounts, billing hooks, AI rate limit, branding)
```

Shared intentionally: Supabase Auth, founder allowlist pattern, Gemini + `assertAiRateLimit` (when AI is wired), Penny UI tokens, `/tools` navigation.

**Not shared / not coupled:** Penny Teacher `classes`, `learners`, `assessments`, `marks`. Oral Assessment keeps its own student and assessment records so it can detach into a standalone SaaS later.

## Engine boundaries

Each engine is a replaceable module under `engines/`:

| Engine | File | Responsibility |
|--------|------|----------------|
| Upload / extract | `utils/extract-document.ts` + storage bucket | Client extract + Supabase Storage |
| Analysis | `engines/analysis-engine.ts` | Learning outcomes, concepts, Bloom, misconceptions |
| Interview | `engines/interview-engine.ts` | Blueprint, adaptive next question, spoken briefing, conversational memory |
| Voice UI | `hooks/useOralTts.ts`, `useOralStt.ts`, `useMicLevel.ts` | Browser TTS + STT with silence end-detection + mic level |
| Scoring | `engines/scoring-engine.ts` | Recommended mark, dimensions, integrity flags |
| Reporting | `engines/reporting-engine.ts` | Official session report JSON |

Sprint 0 uses **placeholder** implementations with stable interfaces. Real Gemini calls plug in without changing routes or tables.

## Database tables

Prefix: `oral_assessment_*`. Apply: `20260803150000_oral_assessment.sql`.

| Table | Purpose |
|-------|---------|
| `oral_assessment_workspaces` | One workspace per lecturer owner; retention + future identity/video toggles |
| `oral_assessment_assessments` | Oral assessment record + analysis JSON + lifecycle status |
| `oral_assessment_files` | Uploaded source/rubric/LO/memo files + extracted text |
| `oral_assessment_rubrics` | Rubric header per assessment |
| `oral_assessment_rubric_criteria` | Weighted criteria rows |
| `oral_assessment_blueprints` | Internal interview blueprint + question bank (audit; never shown as prompts) |
| `oral_assessment_students` | Module-local students (optional `user_id` link) |
| `oral_assessment_invitations` | Student ↔ assessment enrolments + invite token |
| `oral_assessment_sessions` | Interview sessions + unique question pathway |
| `oral_assessment_transcript_turns` | Transcript (primary evidence; not continuous video) |
| `oral_assessment_scores` | AI recommendation + lecturer final mark |
| `oral_assessment_integrity_flags` | Understanding-mismatch flags for lecturer review (never auto-accuse) |
| `oral_assessment_reports` | Official assessment record JSON |
| `oral_assessment_audit_events` | Append-only-ish audit trail |
| `oral_assessment_integrations` | LMS provider stubs (disabled) |

Storage bucket: `oral-assessment` (private, 50 MB, path folder = `auth.uid()`).

### Status vocabularies

- Assessment: `draft | uploading | analysing | ready | published | archived | failed`
- Session: `briefing | in_progress | paused | completed | abandoned | failed`

## Server APIs (`createServerFn`)

All require `requireSupabaseAuth` + `canUseOralAssessment`.

### Workspace

| Fn | Input | Output |
|----|-------|--------|
| `ensureOralAssessmentWorkspace` | — | `{ workspaceId, name, … }` |
| `getOralAssessmentWorkspace` | — | `{ workspace }` |

### Assessment / upload

| Fn | Input | Output |
|----|-------|--------|
| `createOralAssessment` | title, optional LO/memo, files[] (storage paths + extracted text) | `{ assessmentId, status }` |
| `listOralAssessments` | — | `{ assessments }` |
| `getOralAssessment` | `assessmentId` | assessment + files + rubric + blueprint meta + sessions |
| `publishOralAssessment` | `assessmentId` | `{ status: published }` |
| `inviteStudentToAssessment` | assessmentId, email, optional name | `{ studentId, invitation }` |

### Interview / scoring / report

| Fn | Input | Output |
|----|-------|--------|
| `startDemoInterviewSession` | assessmentId | `{ sessionId }` |
| `beginInterviewQuestions` | sessionId | first examiner turn (after briefing TTS) |
| `getInterviewSession` | sessionId | session + turns + score |
| `submitInterviewReply` | sessionId, content, optional responseFormat | next examiner turn or `{ done }` |
| `awardFinalMark` | sessionId, finalMark, optional comment | `{ finalMark }` |
| `listStudentInvitations` | — | invitations for current user |
| `getSessionReport` | sessionId | official report + score |

## Routes

| Path | Page |
|------|------|
| `/tools` | Tools hub (Oral Assessment + Prep Check) |
| `/tools/oral-assessment` | Lecturer dashboard |
| `/tools/oral-assessment/create` | Upload → generate |
| `/tools/oral-assessment/$assessmentId` | Review / publish / invite |
| `/tools/oral-assessment/student` | Student dashboard |
| `/tools/oral-assessment/interview/$sessionId` | Placeholder interview UI |
| `/tools/oral-assessment/report/$sessionId` | Report + award mark |

## Storage strategy

**Default:** transcript, metadata, pathway, rubric, scores, timestamps.

**Optional (schema ready, not built):** temporary video path on session, identity snapshots JSON, workspace retention days, identity verification toggle.

## Academic integrity stance

Do **not** detect AI-written assignments. Flag when oral understanding appears significantly weaker than submitted work → lecturer review only.

## Accessibility (schema-first)

- `default_locale` / student `locale`
- `extra_time_multiplier` on assessment and student
- `alternative_response_format`: speech | text | both
- Transcript `response_format` per turn

## Future identity verification

Workspace flags + session `identity_snapshots` / `temporary_video_path`. UI not built in Sprint 0.

## Future LMS integrations

Table `oral_assessment_integrations` with providers: Moodle, Canvas, Blackboard, Google Classroom, Microsoft Teams, SIS. Status defaults to `disabled`.

## Assumptions (Sprint 0)

1. Founder-gated like Prep Check until `VITE_ORAL_ASSESSMENT_PUBLIC` / `ORAL_ASSESSMENT_PUBLIC`.
2. Tools sit under `/tools/*` (not `_authenticated` subscription shell) for detachability.
3. Demo interview path lets lecturers exercise the pipeline without email delivery.
4. PDF/PPT/image extraction is intentionally thin; richer OCR/server extract later.
5. Placeholder engines return deterministic structured data so UI and DB can be production-shaped now.
6. Generated Supabase `Database` types may lag; services cast tables `as never` until types are regenerated.
7. Continuous video is out of scope by default (founder instruction).

## Removability

Delete `src/features/oral-assessment/`, `src/routes/tools/oral-assessment/`, drop `oral_assessment_*` + bucket `oral-assessment`. Keep `/tools` hub (still lists Prep Check) or trim the Oral Assessment card.
