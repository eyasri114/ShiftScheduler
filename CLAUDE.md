# Shift Scheduler — notes for Claude Code

Web app that builds weekly shift schedules for stores and shift-based businesses
(morning/evening or morning/evening/night), with automatic scheduling from employee
constraints, vacation/sick-leave handling and separate manager and employee views.
UI language: Hebrew, right-to-left.

## Stack
- Next.js 15 (App Router) + TypeScript + Tailwind, in `src/`
- Supabase: PostgreSQL, Auth, Storage (private bucket `absence-attachments`)
- Scheduling engine: TypeScript on the server first (ported from the prototype);
  Python + OR-Tools CP-SAT later if branches grow large.
- Hosting: Vercel (app) + Supabase (data)

## Database
- Migrations live in `supabase/migrations/`, demo data in `supabase/seed.sql`.
- Security is enforced in the database with row-level security, not only in the UI.
  Every new table needs RLS policies and a test in `supabase/tests/01_security_test.sql`.
- `./scripts/test-db.sh` must pass before committing schema changes.
- Conventions: weekday 0 = Sunday … 6 = Saturday; `week_start` is always a Sunday;
  no availability row means "available".
- Employees never see other people's phone numbers, birth dates, constraints or
  absences; coworker names come only from `branch_roster()`.

## Roles
- owner: whole organization; manager: branches they belong to; employee: themselves.
- Vacation needs manager approval; sick leave is approved on entry and its
  certificate is reviewed by a manager.

## Reference
- `docs/prototype.html` is the working prototype — the source of truth for
  behaviour, wording and the scheduling rules.
