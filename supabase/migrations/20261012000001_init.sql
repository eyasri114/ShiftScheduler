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
