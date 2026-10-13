-- =============================================================
-- Shift Scheduler: full database setup for Supabase
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Run it once, on an empty project.
-- =============================================================

-- ---- supabase/migrations/20261012000001_init.sql ----
-- =====================================================================
-- Shift Scheduler — initial schema
-- Target: Supabase (PostgreSQL 15+). Uses auth.users / auth.uid().
--
-- Conventions
--   weekday   0 = Sunday … 6 = Saturday (Israeli week)
--   week_start always a Sunday
--   shift_kind morning | evening | night
--   No availability row = "available". Rows store only prefer / cannot.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------
create type public.member_role        as enum ('owner', 'manager', 'employee');
create type public.shift_kind         as enum ('morning', 'evening', 'night');
create type public.availability_level as enum ('prefer', 'cannot');
create type public.schedule_status    as enum ('draft', 'published');
create type public.absence_type       as enum ('vacation', 'sick');
create type public.absence_status     as enum ('pending', 'approved', 'rejected');
create type public.attachment_review  as enum ('pending', 'valid', 'invalid');

-- ---------------------------------------------------------------------
-- Organizations and branches
-- ---------------------------------------------------------------------
create table public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (length(trim(name)) > 0),
  created_at  timestamptz not null default now()
);

create table public.branches (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references public.organizations(id) on delete cascade,
  name               text not null check (length(trim(name)) > 0),
  timezone           text not null default 'Asia/Jerusalem',
  shift_model        smallint not null default 2 check (shift_model in (2, 3)),
  min_rest_hours     smallint not null default 8  check (min_rest_hours between 0 and 24),
  weekly_rest_hours  smallint not null default 36 check (weekly_rest_hours between 0 and 72),
  require_shift_lead boolean  not null default true,
  closed_weekdays    smallint[] not null default '{}',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index on public.branches (org_id);

-- ---------------------------------------------------------------------
-- Members (everyone who works in an organization)
-- user_id is null until the person accepts the invite and signs in.
-- ---------------------------------------------------------------------
create table public.members (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references public.organizations(id) on delete cascade,
  user_id        uuid unique references auth.users(id) on delete set null,
  full_name      text not null check (length(trim(full_name)) > 0),
  phone          text,
  email          text,
  birth_date     date,
  role           public.member_role not null default 'employee',
  is_active      boolean not null default true,
  is_shift_lead  boolean not null default false,
  allowed_kinds  public.shift_kind[] not null default '{morning,evening,night}',
  rest_weekday   smallint check (rest_weekday between 0 and 6),
  min_shifts     smallint not null default 0 check (min_shifts between 0 and 7),
  max_shifts     smallint not null default 5 check (max_shifts between 0 and 7),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  check (min_shifts <= max_shifts)
);
create index on public.members (org_id);

create table public.branch_members (
  branch_id  uuid not null references public.branches(id) on delete cascade,
  member_id  uuid not null references public.members(id)  on delete cascade,
  primary key (branch_id, member_id)
);
create index on public.branch_members (member_id);

-- ---------------------------------------------------------------------
-- Weekly template: hours and staffing per weekday and shift
-- ---------------------------------------------------------------------
create table public.template_slots (
  branch_id   uuid not null references public.branches(id) on delete cascade,
  weekday     smallint not null check (weekday between 0 and 6),
  kind        public.shift_kind not null,
  start_time  time not null,
  end_time    time not null,          -- may be earlier than start (crosses midnight)
  required    smallint not null default 0 check (required between 0 and 50),
  primary key (branch_id, weekday, kind)
);

-- ---------------------------------------------------------------------
-- Weekly schedules
-- ---------------------------------------------------------------------
create table public.schedules (
  id            uuid primary key default gen_random_uuid(),
  branch_id     uuid not null references public.branches(id) on delete cascade,
  week_start    date not null check (extract(isodow from week_start) = 7),
  status        public.schedule_status not null default 'draft',
  closed_weekdays smallint[] not null default '{}',
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (branch_id, week_start)
);

-- Per-week staffing changes (holiday eve reinforcement, promotions…)
create table public.slot_overrides (
  schedule_id  uuid not null references public.schedules(id) on delete cascade,
  weekday      smallint not null check (weekday between 0 and 6),
  kind         public.shift_kind not null,
  required     smallint not null check (required between 0 and 50),
  primary key (schedule_id, weekday, kind)
);

create table public.assignments (
  id           uuid primary key default gen_random_uuid(),
  schedule_id  uuid not null references public.schedules(id) on delete cascade,
  member_id    uuid not null references public.members(id) on delete cascade,
  weekday      smallint not null check (weekday between 0 and 6),
  kind         public.shift_kind not null,
  is_locked    boolean not null default false,
  -- set when the change happened after publishing; cleared on re-publish
  changed_after_publish boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (schedule_id, member_id, weekday, kind)
);
create index on public.assignments (schedule_id);
create index on public.assignments (member_id);

-- ---------------------------------------------------------------------
-- Availability (constraints submitted by employees)
-- ---------------------------------------------------------------------
create table public.availability (
  member_id   uuid not null references public.members(id) on delete cascade,
  week_start  date not null check (extract(isodow from week_start) = 7),
  weekday     smallint not null check (weekday between 0 and 6),
  kind        public.shift_kind not null,
  level       public.availability_level not null,
  updated_at  timestamptz not null default now(),
  primary key (member_id, week_start, weekday, kind)
);

-- ---------------------------------------------------------------------
-- Absences: vacation (needs approval) and sick leave (approved on entry)
-- attachment_path points into the private "absence-attachments" bucket.
-- ---------------------------------------------------------------------
create table public.absences (
  id                 uuid primary key default gen_random_uuid(),
  member_id          uuid not null references public.members(id) on delete cascade,
  type               public.absence_type not null,
  start_date         date not null,
  end_date           date not null,
  note               text,
  status             public.absence_status not null default 'pending',
  attachment_path    text,
  attachment_review  public.attachment_review,
  reviewed_by        uuid references public.members(id) on delete set null,
  reviewed_at        timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  check (end_date >= start_date)
);
create index on public.absences (member_id, start_date);

-- ---------------------------------------------------------------------
-- Audit log for schedule changes (who, when, what) — payroll disputes
-- ---------------------------------------------------------------------
create table public.schedule_events (
  id           bigint generated always as identity primary key,
  schedule_id  uuid not null references public.schedules(id) on delete cascade,
  actor_user   uuid,
  action       text not null,
  payload      jsonb not null default '{}',
  created_at   timestamptz not null default now()
);
create index on public.schedule_events (schedule_id, created_at);

-- =====================================================================
-- Helper functions (SECURITY DEFINER so policies don't recurse)
-- =====================================================================
create or replace function public.my_member_id(p_org uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.members
  where org_id = p_org and user_id = auth.uid() and is_active
$$;

create or replace function public.is_org_member(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members
                 where org_id = p_org and user_id = auth.uid() and is_active)
$$;

create or replace function public.is_org_manager(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members
                 where org_id = p_org and user_id = auth.uid() and is_active and role in ('owner','manager'))
$$;

create or replace function public.is_org_owner(p_org uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members
                 where org_id = p_org and user_id = auth.uid() and is_active and role = 'owner')
$$;

-- Owner of the branch's org, or a manager assigned to that branch.
create or replace function public.is_branch_manager(p_branch uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from public.branches b
    join public.members m on m.org_id = b.org_id and m.user_id = auth.uid() and m.is_active
    where b.id = p_branch
      and (m.role = 'owner'
           or (m.role = 'manager' and exists (
                 select 1 from public.branch_members bm
                 where bm.branch_id = b.id and bm.member_id = m.id)))
  )
$$;

create or replace function public.is_branch_member(p_branch uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_branch_manager(p_branch) or exists (
    select 1 from public.branch_members bm
    join public.members m on m.id = bm.member_id
    where bm.branch_id = p_branch and m.user_id = auth.uid() and m.is_active)
$$;

-- Can the caller manage this member? (owner of org, or manager of any branch the member is in)
create or replace function public.manages_member(p_member uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.members t
    where t.id = p_member and (
      public.is_org_owner(t.org_id)
      or exists (select 1 from public.branch_members bm
                 where bm.member_id = t.id and public.is_branch_manager(bm.branch_id))))
$$;

create or replace function public.is_self(p_member uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.members
                 where id = p_member and user_id = auth.uid() and is_active)
$$;

-- Coworkers' names for a branch. Employees see names only — never phones,
-- birth dates or other people's constraints.
create or replace function public.branch_roster(p_branch uuid)
returns table (member_id uuid, full_name text, is_shift_lead boolean)
language sql stable security definer set search_path = public as $$
  select m.id, m.full_name, m.is_shift_lead
  from public.branch_members bm
  join public.members m on m.id = bm.member_id and m.is_active
  where bm.branch_id = p_branch and public.is_branch_member(p_branch)
  order by m.full_name
$$;

-- =====================================================================
-- Triggers
-- =====================================================================
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create trigger trg_branches_touch  before update on public.branches  for each row execute function public.touch_updated_at();
create trigger trg_members_touch   before update on public.members   for each row execute function public.touch_updated_at();
create trigger trg_schedules_touch before update on public.schedules for each row execute function public.touch_updated_at();
create trigger trg_absences_touch  before update on public.absences  for each row execute function public.touch_updated_at();

-- Absences: sick leave is approved on entry; employees cannot change
-- status or review fields — only managers can.
create or replace function public.guard_absence()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_manager boolean := auth.uid() is null or public.manages_member(new.member_id);  -- no user = admin
begin
  if tg_op = 'INSERT' then
    if new.type = 'sick' then
      new.status := 'approved';
    elsif not v_manager then
      new.status := 'pending';
    end if;
    if not v_manager then
      new.reviewed_by := null; new.reviewed_at := null;
      new.attachment_review := case when new.attachment_path is null then null else 'pending' end;
    end if;
    return new;
  end if;

  -- UPDATE
  if not v_manager then
    if new.status is distinct from old.status
       or new.reviewed_by is distinct from old.reviewed_by
       or new.reviewed_at is distinct from old.reviewed_at
       or new.member_id  is distinct from old.member_id
       or new.type       is distinct from old.type then
      raise exception 'Only a manager can change the status of an absence' using errcode = '42501';
    end if;
    if old.status <> 'pending' and (new.start_date <> old.start_date or new.end_date <> old.end_date) then
      raise exception 'Dates can only change while the request is pending' using errcode = '42501';
    end if;
    if new.attachment_path is distinct from old.attachment_path then
      new.attachment_review := case when new.attachment_path is null then null else 'pending' end;
    elsif new.attachment_review is distinct from old.attachment_review then
      raise exception 'Only a manager can review an attachment' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;

create trigger trg_absences_guard before insert or update on public.absences
  for each row execute function public.guard_absence();

-- Managers cannot hand out the owner role; only owners can.
create or replace function public.guard_member_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- No signed-in user = the project owner working in the SQL Editor / admin tools.
  if auth.uid() is null then return new; end if;
  if new.role = 'owner' and (tg_op = 'INSERT' or old.role <> 'owner')
     and not public.is_org_owner(new.org_id)
     -- the very first member of a brand-new organization becomes its owner
     and exists (select 1 from public.members where org_id = new.org_id) then
    raise exception 'Only an owner can grant the owner role' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.role = 'owner' and new.role <> 'owner'
     and not public.is_org_owner(new.org_id) then
    raise exception 'Only an owner can change an owner' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger trg_members_role before insert or update on public.members
  for each row execute function public.guard_member_role();

-- Audit every assignment change.
create or replace function public.log_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record := coalesce(new, old);
begin
  insert into public.schedule_events (schedule_id, actor_user, action, payload)
  values (r.schedule_id, auth.uid(), lower(tg_op),
          jsonb_build_object('member_id', r.member_id, 'weekday', r.weekday, 'kind', r.kind,
                             'is_locked', r.is_locked));
  return null;
end $$;

create trigger trg_assignments_log after insert or update or delete on public.assignments
  for each row execute function public.log_assignment();

-- =====================================================================
-- RPC: sign-up flow — create an organization with the caller as owner
-- =====================================================================
create or replace function public.create_organization(p_org_name text, p_branch_name text, p_full_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_branch uuid; v_member uuid; d smallint;
begin
  if auth.uid() is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  if exists (select 1 from public.members where user_id = auth.uid()) then
    raise exception 'This user already belongs to an organization' using errcode = '23505';
  end if;

  insert into public.organizations (name) values (p_org_name) returning id into v_org;
  insert into public.branches (org_id, name) values (v_org, p_branch_name) returning id into v_branch;
  insert into public.members (org_id, user_id, full_name, role, is_shift_lead)
    values (v_org, auth.uid(), p_full_name, 'owner', true) returning id into v_member;
  insert into public.branch_members (branch_id, member_id) values (v_branch, v_member);

  for d in 0..6 loop
    insert into public.template_slots (branch_id, weekday, kind, start_time, end_time, required) values
      (v_branch, d, 'morning', '07:00', '15:00', 2),
      (v_branch, d, 'evening', '15:00', '23:00', 2),
      (v_branch, d, 'night',   '23:00', '07:00', 0);
  end loop;
  return v_org;
end $$;

-- =====================================================================
-- Row-level security
-- =====================================================================
alter table public.organizations   enable row level security;
alter table public.branches        enable row level security;
alter table public.members         enable row level security;
alter table public.branch_members  enable row level security;
alter table public.template_slots  enable row level security;
alter table public.schedules       enable row level security;
alter table public.slot_overrides  enable row level security;
alter table public.assignments     enable row level security;
alter table public.availability    enable row level security;
alter table public.absences        enable row level security;
alter table public.schedule_events enable row level security;

-- organizations
create policy org_select on public.organizations for select to authenticated
  using (public.is_org_member(id));
create policy org_update on public.organizations for update to authenticated
  using (public.is_org_owner(id)) with check (public.is_org_owner(id));

-- branches
create policy branch_select on public.branches for select to authenticated
  using (public.is_branch_member(id));
create policy branch_insert on public.branches for insert to authenticated
  with check (public.is_org_owner(org_id));
create policy branch_update on public.branches for update to authenticated
  using (public.is_branch_manager(id)) with check (public.is_branch_manager(id));
create policy branch_delete on public.branches for delete to authenticated
  using (public.is_org_owner(org_id));

-- members: yourself, or people you manage. Coworker names go through branch_roster().
create policy member_select on public.members for select to authenticated
  using (user_id = auth.uid() or public.manages_member(id) or public.is_org_owner(org_id));
create policy member_insert on public.members for insert to authenticated
  with check (public.is_org_owner(org_id) or public.is_org_manager(org_id));
create policy member_update on public.members for update to authenticated
  using (public.manages_member(id) or public.is_org_owner(org_id))
  with check (public.manages_member(id) or public.is_org_owner(org_id));
create policy member_delete on public.members for delete to authenticated
  using (public.is_org_owner(org_id));

-- branch_members
create policy bm_select on public.branch_members for select to authenticated
  using (public.is_branch_manager(branch_id) or public.is_self(member_id));
create policy bm_write on public.branch_members for all to authenticated
  using (public.is_branch_manager(branch_id)) with check (public.is_branch_manager(branch_id));

-- template_slots
create policy tmpl_select on public.template_slots for select to authenticated
  using (public.is_branch_member(branch_id));
create policy tmpl_write on public.template_slots for all to authenticated
  using (public.is_branch_manager(branch_id)) with check (public.is_branch_manager(branch_id));

-- schedules: employees only see published ones
create policy sched_select on public.schedules for select to authenticated
  using (public.is_branch_manager(branch_id)
         or (status = 'published' and public.is_branch_member(branch_id)));
create policy sched_write on public.schedules for all to authenticated
  using (public.is_branch_manager(branch_id)) with check (public.is_branch_manager(branch_id));

-- slot_overrides
create policy ovr_select on public.slot_overrides for select to authenticated
  using (exists (select 1 from public.schedules s where s.id = schedule_id));  -- inherits schedule visibility
create policy ovr_write on public.slot_overrides for all to authenticated
  using (exists (select 1 from public.schedules s where s.id = schedule_id and public.is_branch_manager(s.branch_id)))
  with check (exists (select 1 from public.schedules s where s.id = schedule_id and public.is_branch_manager(s.branch_id)));

-- assignments: visible wherever the schedule is visible
create policy asg_select on public.assignments for select to authenticated
  using (exists (select 1 from public.schedules s where s.id = schedule_id));
create policy asg_write on public.assignments for all to authenticated
  using (exists (select 1 from public.schedules s where s.id = schedule_id and public.is_branch_manager(s.branch_id)))
  with check (exists (select 1 from public.schedules s where s.id = schedule_id and public.is_branch_manager(s.branch_id)));

-- availability: own rows, or rows of people you manage
create policy avail_select on public.availability for select to authenticated
  using (public.is_self(member_id) or public.manages_member(member_id));
create policy avail_write on public.availability for all to authenticated
  using (public.is_self(member_id) or public.manages_member(member_id))
  with check (public.is_self(member_id) or public.manages_member(member_id));

-- absences: own rows, or rows of people you manage. Employees may delete
-- only their own still-pending vacation requests.
create policy abs_select on public.absences for select to authenticated
  using (public.is_self(member_id) or public.manages_member(member_id));
create policy abs_insert on public.absences for insert to authenticated
  with check (public.is_self(member_id) or public.manages_member(member_id));
create policy abs_update on public.absences for update to authenticated
  using (public.is_self(member_id) or public.manages_member(member_id))
  with check (public.is_self(member_id) or public.manages_member(member_id));
create policy abs_delete on public.absences for delete to authenticated
  using (public.manages_member(member_id)
         or (public.is_self(member_id) and status = 'pending'));

-- schedule_events: managers read; rows are written by trigger only
create policy evt_select on public.schedule_events for select to authenticated
  using (exists (select 1 from public.schedules s where s.id = schedule_id and public.is_branch_manager(s.branch_id)));

-- =====================================================================
-- Privileges (Supabase's API roles)
-- =====================================================================
revoke all on all tables in schema public from anon;
grant select, insert, update, delete on all tables in schema public to authenticated;
revoke insert, update, delete on public.schedule_events from authenticated;
grant usage on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;

-- ---- supabase/migrations/20261012000002_storage.sql ----
-- Private bucket for sick notes and other absence attachments.
-- Object path convention: <member_id>/<absence_id>/<file name>
-- Only the employee and the managers who manage them can read the file.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('absence-attachments', 'absence-attachments', false, 10485760,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
on conflict (id) do nothing;

create policy absence_files_read on storage.objects for select to authenticated
  using (bucket_id = 'absence-attachments'
         and (public.is_self(((storage.foldername(name))[1])::uuid)
              or public.manages_member(((storage.foldername(name))[1])::uuid)));

create policy absence_files_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'absence-attachments'
              and (public.is_self(((storage.foldername(name))[1])::uuid)
                   or public.manages_member(((storage.foldername(name))[1])::uuid)));

create policy absence_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'absence-attachments'
         and public.manages_member(((storage.foldername(name))[1])::uuid));

-- ---- supabase/migrations/20261012000003_auth.sql ----
-- Sign-in support
--
-- Employees are added by a manager with their email address. When that person
-- signs up and confirms the same email, claim_membership() links the account
-- to the employee record. Supabase only issues a session after the email is
-- confirmed, so nobody can claim someone else's record with an unverified email.

create unique index if not exists members_org_email_key
  on public.members (org_id, lower(email)) where email is not null;

create or replace function public.claim_membership()
returns integer language plpgsql security definer set search_path = public as $$
declare v_email text := lower(auth.jwt() ->> 'email'); v_count integer;
begin
  if auth.uid() is null or v_email is null or v_email = '' then return 0; end if;
  if exists (select 1 from public.members where user_id = auth.uid()) then return 0; end if;

  update public.members set user_id = auth.uid()
  where id = (select id from public.members
              where lower(email) = v_email and user_id is null and is_active
              order by created_at limit 1);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Everything the app needs to know about the signed-in person, in one call.
create or replace function public.my_context()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'member_id', m.id,
    'full_name', m.full_name,
    'role',      m.role,
    'org',       jsonb_build_object('id', o.id, 'name', o.name),
    'branches',  coalesce((
      select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name) order by b.name)
      from public.branches b
      where b.org_id = o.id
        and (m.role = 'owner' or exists (select 1 from public.branch_members bm
                                         where bm.branch_id = b.id and bm.member_id = m.id))
    ), '[]'::jsonb))
  from public.members m
  join public.organizations o on o.id = m.org_id
  where m.user_id = auth.uid() and m.is_active
  limit 1
$$;

revoke execute on function public.claim_membership(), public.my_context() from public, anon;
grant  execute on function public.claim_membership(), public.my_context() to authenticated;

-- ---- supabase/migrations/20261012000004_manage_members.sql ----
-- Managing employees from the app
--
-- add_branch_member(): creates an employee and puts them in a branch in one
-- step. (Two separate inserts would fail: until the branch link exists, the
-- manager isn't allowed to see the new record.)
--
-- Only owners can make someone a manager.

create or replace function public.guard_member_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- No signed-in user = the project owner working in the SQL Editor / admin tools.
  if auth.uid() is null then return new; end if;
  if new.role = 'owner' and (tg_op = 'INSERT' or old.role <> 'owner')
     and not public.is_org_owner(new.org_id)
     -- the very first member of a brand-new organization becomes its owner
     and exists (select 1 from public.members where org_id = new.org_id) then
    raise exception 'Only an owner can grant the owner role' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.role = 'owner' and new.role <> 'owner'
     and not public.is_org_owner(new.org_id) then
    raise exception 'Only an owner can change an owner' using errcode = '42501';
  end if;
  if new.role = 'manager' and (tg_op = 'INSERT' or old.role <> 'manager')
     and not public.is_org_owner(new.org_id) then
    raise exception 'Only an owner can make someone a manager' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.role = 'manager' and new.role <> 'manager'
     and not public.is_org_owner(new.org_id) then
    raise exception 'Only an owner can change a manager''s role' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.add_branch_member(p_branch uuid, p_member jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_id uuid;
begin
  if not public.is_branch_manager(p_branch) then
    raise exception 'Only a manager of this branch can add employees' using errcode = '42501';
  end if;
  select org_id into v_org from public.branches where id = p_branch;

  insert into public.members (
    org_id, full_name, email, phone, birth_date, role, is_shift_lead,
    allowed_kinds, rest_weekday, min_shifts, max_shifts)
  values (
    v_org,
    trim(p_member ->> 'full_name'),
    nullif(lower(trim(p_member ->> 'email')), ''),
    nullif(trim(p_member ->> 'phone'), ''),
    nullif(p_member ->> 'birth_date', '')::date,
    coalesce(nullif(p_member ->> 'role', ''), 'employee')::public.member_role,
    coalesce((p_member ->> 'is_shift_lead')::boolean, false),
    coalesce((select array_agg(k::public.shift_kind)
              from jsonb_array_elements_text(p_member -> 'allowed_kinds') k),
             '{morning,evening,night}'),
    nullif(p_member ->> 'rest_weekday', '')::smallint,
    coalesce(nullif(p_member ->> 'min_shifts', '')::smallint, 0),
    coalesce(nullif(p_member ->> 'max_shifts', '')::smallint, 5))
  returning id into v_id;

  insert into public.branch_members (branch_id, member_id) values (p_branch, v_id);
  return v_id;
end $$;

revoke execute on function public.add_branch_member(uuid, jsonb) from public, anon;
grant  execute on function public.add_branch_member(uuid, jsonb) to authenticated;

-- ---- supabase/migrations/20261012000005_absences.sql ----
-- Constraints, vacation and sick leave
--
-- 1. Employees can change their constraints only for weeks that haven't ended.
--    Managers can still correct any week.
-- 2. When an absence is approved (a vacation the manager approves, or sick
--    leave, which is approved on entry), the person is removed from any shifts
--    already assigned on those dates. The audit log records each removal, so
--    the schedule board can show what changed.

drop policy if exists avail_write on public.availability;
create policy avail_write on public.availability for all to authenticated
  using (public.manages_member(member_id)
         or (public.is_self(member_id) and week_start + 6 >= current_date))
  with check (public.manages_member(member_id)
              or (public.is_self(member_id) and week_start + 6 >= current_date));

create or replace function public.apply_approved_absence()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved'
     and (tg_op = 'INSERT' or old.status is distinct from 'approved'
          or old.start_date <> new.start_date or old.end_date <> new.end_date) then
    delete from public.assignments a
    using public.schedules s
    where a.schedule_id = s.id
      and a.member_id = new.member_id
      and (s.week_start + a.weekday) between new.start_date and new.end_date;
  end if;
  return null;
end $$;

create trigger trg_absences_apply after insert or update on public.absences
  for each row execute function public.apply_approved_absence();

-- Who still hasn't submitted constraints for a week (any row counts as submitted).
create or replace function public.availability_summary(p_branch uuid, p_week date)
returns table (member_id uuid, marks integer, cannot integer, prefer integer)
language sql stable security definer set search_path = public as $$
  select bm.member_id,
         count(a.*)::int,
         count(*) filter (where a.level = 'cannot')::int,
         count(*) filter (where a.level = 'prefer')::int
  from public.branch_members bm
  join public.members m on m.id = bm.member_id and m.is_active
  left join public.availability a on a.member_id = bm.member_id and a.week_start = p_week
  where bm.branch_id = p_branch and public.is_branch_manager(p_branch)
  group by bm.member_id
$$;

revoke execute on function public.availability_summary(uuid, date) from public, anon;
grant  execute on function public.availability_summary(uuid, date) to authenticated;

-- ---- supabase/migrations/20261012000006_schedule.sql ----
-- Saving a generated schedule
--
-- apply_schedule() replaces a week's unlocked assignments with a new set in
-- one transaction, touching only what actually changed — so the audit log
-- (and the "who to notify after re-publishing" list) shows real changes only.
-- Runs with the caller's permissions: row-level security still decides.
--
-- Safe to run more than once.

create or replace function public.apply_schedule(p_schedule uuid, p_assignments jsonb)
returns integer language plpgsql security invoker set search_path = public as $$
declare v_changed integer := 0; v_n integer;
begin
  create temp table _new on commit drop as
    select distinct x.member_id, x.weekday, x.kind
    from jsonb_to_recordset(p_assignments) as x(member_id uuid, weekday smallint, kind public.shift_kind);

  delete from public.assignments a
  where a.schedule_id = p_schedule and not a.is_locked
    and not exists (select 1 from _new n
                    where n.member_id = a.member_id and n.weekday = a.weekday and n.kind = a.kind);
  get diagnostics v_n = row_count; v_changed := v_changed + v_n;

  insert into public.assignments (schedule_id, member_id, weekday, kind)
  select p_schedule, n.member_id, n.weekday, n.kind from _new n
  on conflict (schedule_id, member_id, weekday, kind) do nothing;
  get diagnostics v_n = row_count; v_changed := v_changed + v_n;

  return v_changed;
end $$;

-- People whose shifts changed since the schedule was last published.
create or replace function public.changed_since_publish(p_schedule uuid)
returns setof uuid language sql stable security invoker set search_path = public as $$
  select distinct (e.payload ->> 'member_id')::uuid
  from public.schedule_events e
  join public.schedules s on s.id = e.schedule_id
  where e.schedule_id = p_schedule and s.status = 'published'
    and e.action in ('insert', 'delete') and e.created_at > s.published_at
$$;

revoke execute on function public.apply_schedule(uuid, jsonb), public.changed_since_publish(uuid) from public, anon;
grant  execute on function public.apply_schedule(uuid, jsonb), public.changed_since_publish(uuid) to authenticated;

-- ---- supabase/migrations/20261012000007_notifications.sql ----
-- Notifications
--
-- notifications        what each person sees under the bell in the app
-- push_subscriptions   phones/browsers that agreed to receive push alerts
--
-- People create notifications for others only through two functions, which
-- check who may notify whom:
--   notify_members()          a manager → people they manage (schedule, leave decisions)
--   notify_branch_managers()  anyone → the managers of their own branch (new requests)
-- Both return the push subscriptions of the people notified, so the server
-- can send phone alerts without ever reading anyone else's subscriptions.
--
-- Safe to run more than once.

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members(id) on delete cascade,
  kind        text not null,
  title       text not null,
  body        text,
  url         text,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index if not exists notifications_member_idx on public.notifications (member_id, created_at desc);

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index if not exists push_subscriptions_member_idx on public.push_subscriptions (member_id);

alter table public.notifications      enable row level security;
alter table public.push_subscriptions enable row level security;

-- Each person reads and marks their own notifications; nobody inserts directly.
drop policy if exists notif_select on public.notifications;
create policy notif_select on public.notifications for select to authenticated using (public.is_self(member_id));
drop policy if exists notif_update on public.notifications;
create policy notif_update on public.notifications for update to authenticated
  using (public.is_self(member_id)) with check (public.is_self(member_id));
drop policy if exists notif_delete on public.notifications;
create policy notif_delete on public.notifications for delete to authenticated using (public.is_self(member_id));

-- Each person manages only their own devices.
drop policy if exists push_self on public.push_subscriptions;
create policy push_self on public.push_subscriptions for all to authenticated
  using (public.is_self(member_id)) with check (public.is_self(member_id));

grant select, update, delete on public.notifications to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

create or replace function public.notify_members(
  p_members uuid[], p_kind text, p_title text, p_body text, p_url text)
returns table (member_id uuid, endpoint text, p256dh text, auth text)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with targets as (
    select m.id from public.members m
    where m.id = any(p_members) and m.is_active and m.user_id is not null
      and public.manages_member(m.id)
  ), ins as (
    insert into public.notifications (member_id, kind, title, body, url)
    select t.id, p_kind, p_title, p_body, p_url from targets t
    returning notifications.member_id
  )
  select s.member_id, s.endpoint, s.p256dh, s.auth
  from public.push_subscriptions s where s.member_id in (select i.member_id from ins i);
end $$;

create or replace function public.notify_branch_managers(
  p_kind text, p_title text, p_body text, p_url text)
returns table (member_id uuid, endpoint text, p256dh text, auth text)
language plpgsql security definer set search_path = public as $$
declare me public.members;
begin
  select * into me from public.members where user_id = auth.uid() and is_active;
  if me.id is null then return; end if;
  return query
  with targets as (
    select m.id from public.members m
    where m.org_id = me.org_id and m.is_active and m.user_id is not null and m.id <> me.id
      and (m.role = 'owner'
           or (m.role = 'manager' and exists (
                 select 1 from public.branch_members a join public.branch_members b using (branch_id)
                 where a.member_id = m.id and b.member_id = me.id)))
  ), ins as (
    insert into public.notifications (member_id, kind, title, body, url)
    select t.id, p_kind, p_title, p_body, p_url from targets t
    returning notifications.member_id
  )
  select s.member_id, s.endpoint, s.p256dh, s.auth
  from public.push_subscriptions s where s.member_id in (select i.member_id from ins i);
end $$;

-- Phones that unsubscribed or reinstalled: the push service answers "gone".
create or replace function public.remove_dead_subscriptions(p_endpoints text[])
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from public.push_subscriptions s
  where s.endpoint = any(p_endpoints)
    and (public.is_self(s.member_id) or public.manages_member(s.member_id)
         or exists (select 1 from public.members me where me.user_id = auth.uid()));
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.notify_members(uuid[], text, text, text, text),
                           public.notify_branch_managers(text, text, text, text),
                           public.remove_dead_subscriptions(text[]) from public, anon;
grant  execute on function public.notify_members(uuid[], text, text, text, text),
                           public.notify_branch_managers(text, text, text, text),
                           public.remove_dead_subscriptions(text[]) to authenticated;

-- ---- supabase/migrations/20261013000008_swaps.sql ----
-- Shift swaps between employees
--
-- An employee can
--   * give away a shift to a coworker, or
--   * exchange a shift with a coworker's shift.
-- The coworker accepts or declines. Then, per branch setting:
--   swap_approval = 'manager'  → the manager approves or rejects
--   swap_approval = 'auto'     → it happens immediately
-- Either way, the swap only happens if both people still satisfy every
-- scheduling rule (the same hard rules as the scheduling engine), checked in
-- the database at the moment it executes. Swapped shifts are locked so
-- auto-scheduling won't undo an agreed swap.
--
-- Employees never touch shift_swaps or assignments directly: everything goes
-- through the functions below, which check who is allowed to do what.
--
-- Safe to run more than once.

alter table public.branches add column if not exists swap_approval text not null default 'manager';
do $$ begin
  alter table public.branches add constraint branches_swap_approval_check check (swap_approval in ('manager', 'auto'));
exception when duplicate_object then null; end $$;

create table if not exists public.shift_swaps (
  id              uuid primary key default gen_random_uuid(),
  schedule_id     uuid not null references public.schedules(id) on delete cascade,
  requester_id    uuid not null references public.members(id) on delete cascade,
  from_weekday    smallint not null check (from_weekday between 0 and 6),
  from_kind       public.shift_kind not null,
  target_id       uuid not null references public.members(id) on delete cascade,
  to_weekday      smallint check (to_weekday between 0 and 6),   -- null = give away
  to_kind         public.shift_kind,
  note            text,
  status          text not null default 'pending_peer'
                  check (status in ('pending_peer', 'pending_manager', 'approved', 'rejected', 'declined', 'cancelled', 'failed')),
  failure_reason  text,
  decided_by      uuid references public.members(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check ((to_weekday is null) = (to_kind is null)),
  check (requester_id <> target_id)
);
create index if not exists shift_swaps_schedule_idx on public.shift_swaps (schedule_id, status);
create index if not exists shift_swaps_target_idx on public.shift_swaps (target_id, status);
create index if not exists shift_swaps_requester_idx on public.shift_swaps (requester_id, status);

alter table public.shift_swaps enable row level security;
drop policy if exists swaps_select on public.shift_swaps;
create policy swaps_select on public.shift_swaps for select to authenticated
  using (public.is_self(requester_id) or public.is_self(target_id) or public.manages_member(requester_id));
revoke all on public.shift_swaps from anon;
revoke insert, update, delete on public.shift_swaps from authenticated;
grant select on public.shift_swaps to authenticated;

drop trigger if exists trg_swaps_touch on public.shift_swaps;
create trigger trg_swaps_touch before update on public.shift_swaps
  for each row execute function public.touch_updated_at();

-- The audit log now also records who a shift moved from.
create or replace function public.log_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record := coalesce(new, old);
begin
  insert into public.schedule_events (schedule_id, actor_user, action, payload)
  values (r.schedule_id, auth.uid(), lower(tg_op),
          jsonb_build_object('member_id', r.member_id, 'weekday', r.weekday, 'kind', r.kind,
                             'is_locked', r.is_locked,
                             'from_member_id', case when tg_op = 'UPDATE' and old.member_id <> new.member_id
                                                    then old.member_id end));
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Internal helpers (not callable from the app)
-- ---------------------------------------------------------------------------

-- Minutes from Sunday 00:00 of the week to the start and end of a shift.
create or replace function public._slot_bounds(p_branch uuid, p_weekday int, p_kind public.shift_kind,
  out s int, out e int)
language sql stable set search_path = public as $$
  select p_weekday * 1440 + (extract(epoch from t.start_time) / 60)::int,
         p_weekday * 1440 + (extract(epoch from t.start_time) / 60)::int
           + case when t.end_time > t.start_time then (extract(epoch from t.end_time - t.start_time) / 60)::int
                  else 1440 - (extract(epoch from t.start_time - t.end_time) / 60)::int end
  from public.template_slots t
  where t.branch_id = p_branch and t.weekday = p_weekday and t.kind = p_kind
$$;

create or replace function public._shift_label(p_week date, p_weekday int, p_kind public.shift_kind)
returns text language sql stable as $$
  select (array['בוקר', 'ערב', 'לילה'])[case p_kind when 'morning' then 1 when 'evening' then 2 else 3 end]
    || ', יום ' || (array['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'])[p_weekday + 1]
    || ' ' || extract(day from p_week + p_weekday)::int || '.' || extract(month from p_week + p_weekday)::int
$$;

/*
  Why p_member can't work (p_weekday, p_kind) in this schedule, or null.
  Their other shifts that week count, except the one they'd hand over
  (p_drop_*). Mirrors violation() in src/lib/scheduler/engine.ts.
*/
create or replace function public._shift_problem(p_member uuid, p_schedule uuid, p_weekday int, p_kind public.shift_kind,
  p_drop_weekday int default null, p_drop_kind public.shift_kind default null)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  m public.members; sc public.schedules; br public.branches;
  d date; ns int; ne int; r int; cnt int := 0; gap int; maxgap int; o record;
begin
  select * into m from public.members where id = p_member;
  select * into sc from public.schedules where id = p_schedule;
  if m.id is null or sc.id is null then return 'לא נמצא'; end if;
  select * into br from public.branches where id = sc.branch_id;
  if not m.is_active then return 'העובד/ת לא פעיל/ה'; end if;
  if not exists (select 1 from public.branch_members where branch_id = br.id and member_id = m.id) then
    return 'לא עובד/ת בסניף הזה';
  end if;

  d := sc.week_start + p_weekday;
  select b.s, b.e into ns, ne from public._slot_bounds(br.id, p_weekday, p_kind) b;
  if ns is null then return 'אין משמרת כזו'; end if;

  if exists (select 1 from public.absences a where a.member_id = m.id and a.status = 'approved'
             and d between a.start_date and a.end_date) then
    return 'בחופשה או במחלה';
  end if;
  if m.rest_weekday is not null then
    r := m.rest_weekday * 1440;
    if (ns < r + 1440 and ne > r) or (ns < r + 10080 + 1440 and ne > r + 10080) then
      return 'יום המנוחה הקבוע שלו/ה';
    end if;
  end if;
  if exists (select 1 from public.availability v where v.member_id = m.id and v.week_start = sc.week_start
             and v.weekday = p_weekday and v.kind = p_kind and v.level = 'cannot') then
    return 'סימן/ה שלא יכול/ה להגיע';
  end if;
  if not (p_kind = any (m.allowed_kinds)) then return 'לא מוגדר/ת למשמרת כזו'; end if;
  if m.birth_date is not null and d < (m.birth_date + interval '18 years')::date
     and ((ns % 1440) < 360 or (ns % 1440) + (ne - ns) > 1320) then
    return 'קטין/ה: אסור לעבוד בין 22:00 ל-06:00';
  end if;

  for o in
    select b.s, b.e, a.weekday
    from public.assignments a cross join lateral public._slot_bounds(br.id, a.weekday, a.kind) b
    where a.schedule_id = sc.id and a.member_id = m.id and b.s is not null
      and not (a.weekday = p_weekday and a.kind = p_kind)
      and not (p_drop_weekday is not null and a.weekday = p_drop_weekday and a.kind = p_drop_kind)
  loop
    cnt := cnt + 1;
    if o.weekday = p_weekday then return 'כבר משובץ/ת באותו יום'; end if;
    gap := case when o.e <= ns then ns - o.e when ne <= o.s then o.s - ne else -1 end;
    if gap < 0 then return 'חופף למשמרת אחרת'; end if;
    if gap < br.min_rest_hours * 60 then
      return format('רק %s שעות מנוחה בין משמרות', round(gap / 60.0, 1));
    end if;
  end loop;
  if cnt + 1 > m.max_shifts then return format('מעל המקסימום (%s משמרות)', m.max_shifts); end if;

  with iv as (
    select b.s, b.e
    from public.assignments a cross join lateral public._slot_bounds(br.id, a.weekday, a.kind) b
    where a.schedule_id = sc.id and a.member_id = m.id and b.s is not null
      and not (a.weekday = p_weekday and a.kind = p_kind)
      and not (p_drop_weekday is not null and a.weekday = p_drop_weekday and a.kind = p_drop_kind)
    union all select ns, ne
  ), o2 as (
    select iv.s, iv.e, max(iv.e) over (order by iv.s rows between unbounded preceding and 1 preceding) as pe from iv
  )
  select greatest(max(o2.s - coalesce(o2.pe, 0)), 10080 - max(o2.e) + min(o2.s)) into maxgap from o2;
  if maxgap < br.weekly_rest_hours * 60 then
    return format('אין %s שעות מנוחה רצופות בשבוע', br.weekly_rest_hours);
  end if;
  return null;
end $$;

-- Can this swap happen right now? Null = yes.
create or replace function public._swap_problem(sw public.shift_swaps)
returns text language plpgsql stable security definer set search_path = public as $$
declare sc public.schedules; req text; tgt text; p text; today date := (now() at time zone 'Asia/Jerusalem')::date;
begin
  select * into sc from public.schedules where id = sw.schedule_id;
  select full_name into req from public.members where id = sw.requester_id;
  select full_name into tgt from public.members where id = sw.target_id;
  if sc.status <> 'published' then return 'הסידור כבר לא מפורסם'; end if;
  if sc.week_start + sw.from_weekday < today or (sw.to_weekday is not null and sc.week_start + sw.to_weekday < today) then
    return 'המשמרת כבר עברה';
  end if;
  if not exists (select 1 from public.assignments where schedule_id = sw.schedule_id and member_id = sw.requester_id
                 and weekday = sw.from_weekday and kind = sw.from_kind) then
    return format('%s כבר לא משובץ/ת במשמרת הזו', req);
  end if;
  if exists (select 1 from public.assignments where schedule_id = sw.schedule_id and member_id = sw.target_id
             and weekday = sw.from_weekday and kind = sw.from_kind) then
    return format('%s כבר משובץ/ת במשמרת הזו', tgt);
  end if;

  if sw.to_weekday is null then
    p := public._shift_problem(sw.target_id, sw.schedule_id, sw.from_weekday, sw.from_kind);
    return case when p is null then null else tgt || ': ' || p end;
  end if;

  if not exists (select 1 from public.assignments where schedule_id = sw.schedule_id and member_id = sw.target_id
                 and weekday = sw.to_weekday and kind = sw.to_kind) then
    return format('%s כבר לא משובץ/ת במשמרת שהוצעה בתמורה', tgt);
  end if;
  if exists (select 1 from public.assignments where schedule_id = sw.schedule_id and member_id = sw.requester_id
             and weekday = sw.to_weekday and kind = sw.to_kind) then
    return format('%s כבר משובץ/ת במשמרת שהוצעה בתמורה', req);
  end if;
  p := public._shift_problem(sw.target_id, sw.schedule_id, sw.from_weekday, sw.from_kind, sw.to_weekday, sw.to_kind);
  if p is not null then return tgt || ': ' || p; end if;
  p := public._shift_problem(sw.requester_id, sw.schedule_id, sw.to_weekday, sw.to_kind, sw.from_weekday, sw.from_kind);
  if p is not null then return req || ': ' || p; end if;
  return null;
end $$;

create or replace function public._execute_swap(sw public.shift_swaps)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.assignments set member_id = sw.target_id, is_locked = true
  where schedule_id = sw.schedule_id and member_id = sw.requester_id
    and weekday = sw.from_weekday and kind = sw.from_kind;
  if sw.to_weekday is not null then
    update public.assignments set member_id = sw.requester_id, is_locked = true
    where schedule_id = sw.schedule_id and member_id = sw.target_id
      and weekday = sw.to_weekday and kind = sw.to_kind;
  end if;
end $$;

-- Owner and the managers of the member's branches (with an account), minus excluded people.
create or replace function public._managers_of(p_member uuid, p_exclude uuid[])
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct x.id), '{}')
  from public.members x join public.members t on t.id = p_member
  where x.org_id = t.org_id and x.is_active and x.user_id is not null
    and not (x.id = any (p_exclude))
    and (x.role = 'owner' or (x.role = 'manager' and exists (
          select 1 from public.branch_members a join public.branch_members b using (branch_id)
          where a.member_id = x.id and b.member_id = t.id)))
$$;

-- Creates in-app notifications and returns the push alerts to send.
create or replace function public._notify(p_members uuid[], p_kind text, p_title text, p_body text, p_url text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  insert into public.notifications (member_id, kind, title, body, url)
  select m.id, p_kind, p_title, p_body, p_url from public.members m
  where m.id in (select unnest(p_members)) and m.is_active and m.user_id is not null;

  select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
                                               'title', p_title, 'body', p_body, 'url', p_url)), '[]'::jsonb)
  into v
  from public.push_subscriptions s join public.members m on m.id = s.member_id
  where s.member_id in (select unnest(p_members)) and m.is_active and m.user_id is not null;
  return v;
end $$;

create or replace function public._me()
returns public.members language sql stable security definer set search_path = public as $$
  select * from public.members where user_id = auth.uid() and is_active limit 1
$$;

-- ---------------------------------------------------------------------------
-- Functions the app calls. Each returns {ok, message, push}.
-- ---------------------------------------------------------------------------

-- Who could take my shift, and which of their shifts I could take in exchange.
create or replace function public.swap_options(p_schedule uuid, p_weekday int, p_kind public.shift_kind)
returns table (member_id uuid, full_name text, can_take boolean, exchange jsonb)
language sql stable security definer set search_path = public as $$
  with me as (select * from public._me()),
  sc as (
    select s.* from public.schedules s, me
    where s.id = p_schedule and s.status = 'published'
      and exists (select 1 from public.assignments a where a.schedule_id = s.id and a.member_id = me.id
                  and a.weekday = p_weekday and a.kind = p_kind)
  )
  select c.id, c.full_name,
    public._shift_problem(c.id, sc.id, p_weekday, p_kind) is null
      and not exists (select 1 from public.assignments x where x.schedule_id = sc.id and x.member_id = c.id
                      and x.weekday = p_weekday and x.kind = p_kind),
    coalesce((
      select jsonb_agg(jsonb_build_object('weekday', a.weekday, 'kind', a.kind,
                                          'label', public._shift_label(sc.week_start, a.weekday, a.kind))
                       order by a.weekday, a.kind)
      from public.assignments a
      where a.schedule_id = sc.id and a.member_id = c.id
        and not (a.weekday = p_weekday and a.kind = p_kind)
        and sc.week_start + a.weekday >= (now() at time zone 'Asia/Jerusalem')::date
        and not exists (select 1 from public.assignments x where x.schedule_id = sc.id and x.member_id = me.id
                        and x.weekday = a.weekday and x.kind = a.kind)
        and not exists (select 1 from public.assignments x where x.schedule_id = sc.id and x.member_id = c.id
                        and x.weekday = p_weekday and x.kind = p_kind)
        and public._shift_problem(c.id, sc.id, p_weekday, p_kind, a.weekday, a.kind) is null
        and public._shift_problem(me.id, sc.id, a.weekday, a.kind, p_weekday, p_kind) is null
    ), '[]'::jsonb)
  from sc, me
  join public.branch_members bm on true
  join public.members c on c.id = bm.member_id
  where bm.branch_id = sc.branch_id and c.id <> me.id and c.is_active and c.user_id is not null
  order by c.full_name
$$;

create or replace function public.request_swap(p_schedule uuid, p_from_weekday int, p_from_kind public.shift_kind,
  p_target uuid, p_to_weekday int default null, p_to_kind public.shift_kind default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.members; tgt public.members; sc public.schedules; sw public.shift_swaps; p text; push jsonb;
begin
  me := public._me();
  if me.id is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select * into sc from public.schedules where id = p_schedule;
  if sc.id is null or not exists (select 1 from public.branch_members where branch_id = sc.branch_id and member_id = me.id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if sc.status <> 'published' then
    return jsonb_build_object('ok', false, 'message', 'אפשר לבקש החלפה רק בסידור שפורסם.');
  end if;
  select * into tgt from public.members where id = p_target;
  if tgt.id is null or tgt.id = me.id or tgt.org_id <> me.org_id then
    return jsonb_build_object('ok', false, 'message', 'בחרו עובד/ת אחר/ת מהסניף.');
  end if;
  if tgt.user_id is null then
    return jsonb_build_object('ok', false, 'message', format('ל%s אין עדיין חשבון באפליקציה.', tgt.full_name));
  end if;
  if exists (select 1 from public.shift_swaps where schedule_id = p_schedule and requester_id = me.id
             and from_weekday = p_from_weekday and from_kind = p_from_kind
             and status in ('pending_peer', 'pending_manager')) then
    return jsonb_build_object('ok', false, 'message', 'כבר יש בקשה פתוחה על המשמרת הזו.');
  end if;

  sw.schedule_id := p_schedule; sw.requester_id := me.id; sw.target_id := tgt.id;
  sw.from_weekday := p_from_weekday; sw.from_kind := p_from_kind;
  sw.to_weekday := p_to_weekday; sw.to_kind := p_to_kind;
  p := public._swap_problem(sw);
  if p is not null then return jsonb_build_object('ok', false, 'message', 'אי אפשר: ' || p); end if;

  insert into public.shift_swaps (schedule_id, requester_id, from_weekday, from_kind, target_id, to_weekday, to_kind, note)
  values (p_schedule, me.id, p_from_weekday, p_from_kind, tgt.id, p_to_weekday, p_to_kind, nullif(trim(p_note), ''))
  returning * into sw;

  push := public._notify(array[tgt.id], 'swap_requested',
    case when p_to_weekday is null then format('%s מציע/ה לך משמרת', me.full_name)
         else format('%s מבקש/ת להחליף איתך משמרת', me.full_name) end,
    public._shift_label(sc.week_start, p_from_weekday, p_from_kind)
      || case when p_to_weekday is null then '' else ' ⇄ ' || public._shift_label(sc.week_start, p_to_weekday, p_to_kind) end
      || coalesce(' · ' || sw.note, ''),
    '/schedule?week=' || sc.week_start);
  return jsonb_build_object('ok', true, 'message', format('הבקשה נשלחה ל%s.', tgt.full_name), 'push', push);
end $$;

create or replace function public.respond_swap(p_swap uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.members; sw public.shift_swaps; sc public.schedules; req public.members; mode text;
        p text; push jsonb; label text; url text;
begin
  me := public._me();
  select * into sw from public.shift_swaps where id = p_swap for update;
  if me.id is null or sw.id is null or sw.target_id <> me.id then raise exception 'Not allowed' using errcode = '42501'; end if;
  if sw.status <> 'pending_peer' then return jsonb_build_object('ok', false, 'message', 'הבקשה כבר לא פתוחה.'); end if;
  select * into sc from public.schedules where id = sw.schedule_id;
  select * into req from public.members where id = sw.requester_id;
  label := public._shift_label(sc.week_start, sw.from_weekday, sw.from_kind)
    || case when sw.to_weekday is null then '' else ' ⇄ ' || public._shift_label(sc.week_start, sw.to_weekday, sw.to_kind) end;
  url := '/schedule?week=' || sc.week_start;

  if not p_accept then
    update public.shift_swaps set status = 'declined' where id = sw.id;
    push := public._notify(array[req.id], 'swap_declined', format('%s דחה/תה את בקשת ההחלפה', me.full_name), label, url);
    return jsonb_build_object('ok', true, 'message', 'הבקשה נדחתה.', 'push', push);
  end if;

  p := public._swap_problem(sw);
  if p is not null then
    update public.shift_swaps set status = 'failed', failure_reason = p where id = sw.id;
    push := public._notify(array[req.id], 'swap_failed', 'ההחלפה לא התאפשרה', p, url);
    return jsonb_build_object('ok', false, 'message', 'אי אפשר לבצע את ההחלפה: ' || p, 'push', push);
  end if;

  select swap_approval into mode from public.branches where id = sc.branch_id;
  if mode = 'auto' then
    perform public._execute_swap(sw);
    update public.shift_swaps set status = 'approved' where id = sw.id;
    push := public._notify(array[req.id], 'swap_done', format('ההחלפה עם %s בוצעה', me.full_name), label, url)
         || public._notify(public._managers_of(req.id, array[req.id, me.id]), 'swap_done',
              format('%s ו%s החליפו משמרות', req.full_name, me.full_name), label, url);
    return jsonb_build_object('ok', true, 'message', 'ההחלפה בוצעה, והסידור עודכן.', 'push', push);
  end if;

  update public.shift_swaps set status = 'pending_manager' where id = sw.id;
  push := public._notify(array[req.id], 'swap_accepted', format('%s הסכים/ה להחלפה', me.full_name),
            'ממתין לאישור המנהל · ' || label, url)
       || public._notify(public._managers_of(req.id, array[req.id, me.id]), 'swap_needs_approval',
            'בקשת החלפת משמרות ממתינה לאישורך', format('%s ⇄ %s · %s', req.full_name, me.full_name, label), url);
  return jsonb_build_object('ok', true, 'message', 'הסכמת. הבקשה עברה לאישור המנהל.', 'push', push);
end $$;

create or replace function public.decide_swap(p_swap uuid, p_approve boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.members; sw public.shift_swaps; sc public.schedules; p text; push jsonb; label text; url text;
begin
  me := public._me();
  select * into sw from public.shift_swaps where id = p_swap for update;
  if me.id is null or sw.id is null or not public.manages_member(sw.requester_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if sw.status <> 'pending_manager' then return jsonb_build_object('ok', false, 'message', 'הבקשה כבר לא ממתינה לאישור.'); end if;
  select * into sc from public.schedules where id = sw.schedule_id;
  label := public._shift_label(sc.week_start, sw.from_weekday, sw.from_kind)
    || case when sw.to_weekday is null then '' else ' ⇄ ' || public._shift_label(sc.week_start, sw.to_weekday, sw.to_kind) end;
  url := '/schedule?week=' || sc.week_start;

  if not p_approve then
    update public.shift_swaps set status = 'rejected', decided_by = me.id where id = sw.id;
    push := public._notify(array[sw.requester_id, sw.target_id], 'swap_rejected', 'המנהל לא אישר את ההחלפה', label, url);
    return jsonb_build_object('ok', true, 'message', 'ההחלפה נדחתה.', 'push', push);
  end if;

  p := public._swap_problem(sw);
  if p is not null then
    update public.shift_swaps set status = 'failed', failure_reason = p, decided_by = me.id where id = sw.id;
    push := public._notify(array[sw.requester_id, sw.target_id], 'swap_failed', 'ההחלפה לא התאפשרה', p, url);
    return jsonb_build_object('ok', false, 'message', 'אי אפשר לבצע את ההחלפה: ' || p, 'push', push);
  end if;
  perform public._execute_swap(sw);
  update public.shift_swaps set status = 'approved', decided_by = me.id where id = sw.id;
  push := public._notify(array[sw.requester_id, sw.target_id], 'swap_done', 'ההחלפה אושרה', label, url);
  return jsonb_build_object('ok', true, 'message', 'ההחלפה אושרה, והסידור עודכן.', 'push', push);
end $$;

create or replace function public.cancel_swap(p_swap uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.members; sw public.shift_swaps; sc public.schedules; push jsonb;
begin
  me := public._me();
  select * into sw from public.shift_swaps where id = p_swap for update;
  if me.id is null or sw.id is null or sw.requester_id <> me.id then raise exception 'Not allowed' using errcode = '42501'; end if;
  if sw.status not in ('pending_peer', 'pending_manager') then
    return jsonb_build_object('ok', false, 'message', 'הבקשה כבר לא פתוחה.');
  end if;
  select * into sc from public.schedules where id = sw.schedule_id;
  update public.shift_swaps set status = 'cancelled' where id = sw.id;
  push := public._notify(array[sw.target_id], 'swap_cancelled', format('%s ביטל/ה את בקשת ההחלפה', me.full_name),
            public._shift_label(sc.week_start, sw.from_weekday, sw.from_kind), '/schedule?week=' || sc.week_start);
  return jsonb_build_object('ok', true, 'message', 'הבקשה בוטלה.', 'push', push);
end $$;

-- Permissions: internal helpers are never callable from the app.
revoke execute on function public._slot_bounds(uuid, int, public.shift_kind),
                           public._shift_label(date, int, public.shift_kind),
                           public._shift_problem(uuid, uuid, int, public.shift_kind, int, public.shift_kind),
                           public._swap_problem(public.shift_swaps),
                           public._execute_swap(public.shift_swaps),
                           public._managers_of(uuid, uuid[]),
                           public._notify(uuid[], text, text, text, text),
                           public._me()
  from public, anon, authenticated;
revoke execute on function public.swap_options(uuid, int, public.shift_kind),
                           public.request_swap(uuid, int, public.shift_kind, uuid, int, public.shift_kind, text),
                           public.respond_swap(uuid, boolean),
                           public.decide_swap(uuid, boolean),
                           public.cancel_swap(uuid)
  from public, anon;
grant execute on function public.swap_options(uuid, int, public.shift_kind),
                          public.request_swap(uuid, int, public.shift_kind, uuid, int, public.shift_kind, text),
                          public.respond_swap(uuid, boolean),
                          public.decide_swap(uuid, boolean),
                          public.cancel_swap(uuid)
  to authenticated;
