# Shift Scheduler

Weekly shift scheduling for stores and shift-based businesses: automatic
scheduling from employee constraints, vacation and sick-leave handling, and
separate manager and employee views. Hebrew, right-to-left.

**Stack:** Next.js 15 · TypeScript · Tailwind · Supabase (PostgreSQL, Auth, Storage)

## Status

| Step | What | Status |
| --- | --- | --- |
| 1 | Project setup, database schema, row-level security, demo data, tests | ✅ done |
| 2 | Connect Supabase, sign-in for managers and employees | ✅ done |
| 3 | Manager screens: branch settings, employees | ✅ done |
| 4 | Availability, vacation and sick leave (private sick-note storage) | next |
| 5 | Scheduling engine + schedule board, publish | |
| 6 | Employee mobile app (PWA), notifications, deploy to Vercel | |

## Getting started

1. **Database.** In Supabase open **SQL Editor → New query**, paste all of
   `supabase/setup-supabase.sql` and click **Run**. Optional: run
   `supabase/demo-data.sql` the same way for the demo branch with 12 employees.
2. **Sign-in links.** In Supabase open **Authentication → URL Configuration**: set
   *Site URL* to `http://localhost:3000` and add `http://localhost:3000/**` under
   *Redirect URLs*.
3. **App settings.** Copy `.env.example` to `.env.local` and fill in the Project URL
   and anon key from **Settings → API**.
4. **Run.** `npm install`, then `npm run dev`, and open http://localhost:3000.

### How sign-in works

- Email and password, with email confirmation (Supabase sends the email).
- A new account that isn't linked to a business goes to **onboarding** and opens
  a business; that person becomes its owner.
- Employees are added by a manager with their email address. When they sign up
  with that email and confirm it, `claim_membership()` links them to their record.
- Supabase's built-in email sender allows only a few emails per hour, which is
  fine for testing. For real use, connect an email provider under
  **Authentication → Emails → SMTP**.

## Database

```
supabase/
  migrations/
    20261012000001_init.sql      tables, rules, row-level security, sign-up function
    20261012000002_storage.sql   private bucket for sick notes (Supabase only)
    20261012000003_auth.sql      links invited employees to their accounts; my_context()
    20261012000004_manage_members.sql  add_branch_member(); only owners create managers
  setup-supabase.sql             all migrations in one file, to paste into Supabase
  demo-data.sql                  optional demo branch, with you as owner
  seed.sql                       demo branch with 12 employees (same as the prototype)
  tests/
    00_supabase_stub.sql         stands in for Supabase auth when testing on plain PostgreSQL
    01_security_test.sql         30 checks of who can see and change what
    02_auth_test.sql             7 checks of account linking
    03_manage_members_test.sql   9 checks of adding and editing employees
```

Main tables: `organizations`, `branches`, `members`, `branch_members`,
`template_slots` (hours and staffing per weekday), `schedules`, `slot_overrides`
(per-week changes such as holiday eves), `assignments`, `availability`,
`absences`, `schedule_events` (audit log).

## App screens

| Page | Who | What |
| --- | --- | --- |
| `/login`, `/signup` | everyone | sign in, sign up, email confirmation |
| `/onboarding` | new account | open a new business |
| `/` | everyone | home: team list; managers get shortcuts |
| `/employees` | managers | list, add, edit, active/inactive, rest day, shift lead, minors |
| `/employees/[id]` | managers | edit one employee |
| `/settings` | managers | shift model, hours and staffing per weekday, closed days, rest rules |

### What the database guarantees

- Employees see only their own record, constraints and absences; coworkers' names
  come from `branch_roster()` without phones or birth dates.
- Employees see a schedule only after it is published, and cannot assign themselves.
- Vacation requests from employees always start as pending; only a manager can
  approve them. Sick leave is approved on entry; its certificate waits for a
  manager's review.
- Managers cannot grant the owner role. Businesses never see each other's data.
- Every assignment change is written to an audit log nobody can edit.

### Run the tests

Needs PostgreSQL 15+ and `psql`. With Docker:

```bash
docker run -d --name shifts-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
PGURL=postgres://postgres:postgres@localhost:5432 ./scripts/test-db.sh
```

`docs/prototype.html` is the working prototype the app is being built from —
open it in a browser.
