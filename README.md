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
| 4 | Availability, vacation and sick leave (private sick-note storage) | ✅ done |
| 5 | Scheduling engine + schedule board, publish | ✅ done |
| 6 | Phone app (installable), notifications and push alerts, ready to deploy | ✅ done |
| 7 | Shift swaps between employees (manager approval or automatic, per branch) | ✅ done |

## Notifications

| Event | Who is told |
| --- | --- |
| Schedule published | everyone with shifts that week |
| Published schedule changed | only the people whose shifts changed |
| Vacation approved / rejected | the employee |
| Sick note marked invalid | the employee |
| New vacation request, sick report, sick note attached | the branch managers and the owner |
| Swap requested / accepted / declined / approved / done | the people involved, and the managers when their approval is needed (or, in automatic mode, after it happened) |

Each notification appears under the bell in the app, and as a push alert on every
phone the person enabled. Push needs VAPID keys (see `DEPLOY.md`); without them the
in-app notifications still work. The app installs to the home screen (manifest +
service worker); the service worker only handles alerts and never caches pages, so
schedules are always current.

**Going live:** see [`DEPLOY.md`](DEPLOY.md).

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
    20261012000005_absences.sql  past weeks locked for employees; approved absences clear shifts
    20261012000006_schedule.sql  apply_schedule() saves only real changes; changed_since_publish()
    20261012000007_notifications.sql  in-app notifications, push subscriptions, who may notify whom
    20261013000008_swaps.sql     shift swaps, rule checks in SQL, approval mode per branch
  setup-supabase.sql             all migrations in one file, to paste into Supabase
  demo-data.sql                  optional demo branch, with you as owner
  seed.sql                       demo branch with 12 employees (same as the prototype)
  tests/
    00_supabase_stub.sql         stands in for Supabase auth when testing on plain PostgreSQL
    01_security_test.sql         30 checks of who can see and change what
    02_auth_test.sql             7 checks of account linking
    03_manage_members_test.sql   9 checks of adding and editing employees
    04_absences_test.sql         9 checks of constraints, vacation and sick leave
    05_schedule_test.sql         6 checks of saving and publishing schedules
    06_notifications_test.sql    12 checks of notifications and push subscriptions
    07_swaps_test.sql            35 checks of swap rules, both approval modes and privacy
```

Main tables: `organizations`, `branches`, `members`, `branch_members`,
`template_slots` (hours and staffing per weekday), `schedules`, `slot_overrides`
(per-week changes such as holiday eves), `assignments`, `availability`,
`absences`, `shift_swaps`, `notifications`, `push_subscriptions`, `schedule_events` (audit log).

## App screens

| Page | Who | What |
| --- | --- | --- |
| `/login`, `/signup` | everyone | sign in, sign up, email confirmation |
| `/onboarding` | new account | open a new business |
| `/` | everyone | home: team list; managers get shortcuts |
| `/schedule` | everyone | managers: auto-schedule, edit, lock, staff up a week, close a day, publish; employees: the published week with their shifts |
| `/availability` | everyone | employees mark prefer / can't per shift; managers see who submitted and can edit |
| `/absences` | everyone | vacation requests (manager approves), sick leave with certificate upload and review |
| `/notifications` | everyone | in-app notifications; turn on push alerts for this phone, send a test |
| `/employees` | managers | list, add, edit, active/inactive, rest day, shift lead, minors |
| `/employees/[id]` | managers | edit one employee |
| `/settings` | managers | shift model, hours and staffing per weekday, closed days, rest rules |

## Scheduling engine

`src/lib/scheduler/engine.ts` — plain TypeScript with no database or React code,
so the same rules run on the server (auto-schedule) and in the browser (instant
checks on the board).

- **Never broken by the engine:** approved vacation or sick leave, fixed rest day
  (including a night shift running into it), "can't" constraints, shift types the
  person isn't set up for, minors between 22:00 and 06:00, weekly maximum, one
  shift per day, minimum rest between shifts, weekly continuous rest.
- **Weighed:** every shift fully staffed, a shift lead on every shift, preferences,
  each person's weekly minimum, even spread of shifts, nights and weekends,
  avoiding people with a pending vacation request, fewer morning/evening jumps.
- **Method:** greedy fill (hardest shifts first), then local search (moves and
  swaps), best of several restarts. Locked assignments are kept.
- **Tests:** `npm run test:engine` — 10 tests, including a 60-person branch with
  three shifts a day in under 5 seconds.

## Shift swaps

An employee opens **החלפה** next to one of their shifts and either **gives it** to a
coworker or **exchanges** it for one of the coworker's shifts. Only coworkers and
shifts that keep both people within every hard rule are offered. The coworker
accepts or declines; then, depending on the branch setting:

- **באישור מנהל** (default): the manager approves or rejects on the schedule board.
- **אוטומטית**: it happens at once, and the managers are told.

The rules are checked again in the database at the moment the swap executes
(`_shift_problem()` mirrors the engine's `violation()`), so a swap that became
invalid in the meantime fails instead of breaking a rule. Swapped shifts are
locked so auto-scheduling won't undo them, and an agreed swap doesn't count as an
unpublished change. Employees can't call the rule checker themselves, so they
can't probe coworkers' constraints or absences.

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

Engine tests need only Node: `npm run test:engine`.

Database tests need PostgreSQL 15+ and `psql`. With Docker:

```bash
docker run -d --name shifts-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16
PGURL=postgres://postgres:postgres@localhost:5432 ./scripts/test-db.sh
```

`docs/prototype.html` is the working prototype the app is being built from —
open it in a browser.
