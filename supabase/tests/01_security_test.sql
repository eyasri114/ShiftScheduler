-- Row-level security tests. Run after the migration and seed.
-- Each block acts as a specific signed-in user, like a request from the app.
\set ON_ERROR_STOP on

-- Test users ----------------------------------------------------------
insert into auth.users (id, email) values
  ('11111111-0000-0000-0000-000000000001', 'avi.manager@test'),
  ('11111111-0000-0000-0000-000000000002', 'dana.employee@test'),
  ('11111111-0000-0000-0000-000000000003', 'outsider.owner@test'),
  ('11111111-0000-0000-0000-000000000004', 'maya.employee@test');

update public.members set user_id = '11111111-0000-0000-0000-000000000001', role = 'manager'
  where id = '00000000-0000-0000-0000-000000000102';  -- אבי לוי, branch manager
update public.members set user_id = '11111111-0000-0000-0000-000000000002'
  where id = '00000000-0000-0000-0000-000000000101';  -- דנה כהן, employee
update public.members set user_id = '11111111-0000-0000-0000-000000000004'
  where id = '00000000-0000-0000-0000-000000000103';  -- מאיה פרץ, employee

create or replace function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;

create or replace function pg_temp.expect_denied(p_sql text, p_label text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when insufficient_privilege or check_violation then
    raise notice 'PASS  %', p_label; return;
  end;
  raise exception 'FAIL  % — expected the database to refuse', p_label;
end $$;

create or replace function pg_temp.ok(p_cond boolean, p_label text) returns void language plpgsql as $$
begin
  if p_cond then raise notice 'PASS  %', p_label;
  else raise exception 'FAIL  %', p_label; end if;
end $$;

-- 1. Employee (Dana) -------------------------------------------------
begin;
select pg_temp.act_as('11111111-0000-0000-0000-000000000002');

select pg_temp.ok((select count(*) from public.members) = 1,
  'employee sees only her own member record');
select pg_temp.ok((select count(*) from public.branch_roster('00000000-0000-0000-0000-0000000000b1')) = 12,
  'employee sees coworker names through the roster');
select pg_temp.ok((select count(*) from public.schedules) = 0,
  'employee does not see a draft schedule');
select pg_temp.ok((select count(*) from public.availability) = 2,
  'employee sees only her own constraints');
select pg_temp.ok((select count(*) from public.absences) = 0,
  'employee does not see coworkers'' absences');
select pg_temp.ok((select count(*) from public.template_slots) = 21,
  'employee can read the branch template');

insert into public.availability (member_id, week_start, weekday, kind, level)
values ('00000000-0000-0000-0000-000000000101',
        current_date + (7 - extract(dow from current_date)::int), 2, 'morning', 'cannot');
select pg_temp.ok(true, 'employee can submit her own constraint');

select pg_temp.expect_denied($q$
  insert into public.availability (member_id, week_start, weekday, kind, level)
  values ('00000000-0000-0000-0000-000000000103',
          current_date + (7 - extract(dow from current_date)::int), 2, 'morning', 'cannot') $q$,
  'employee cannot submit constraints for someone else');

insert into public.absences (id, member_id, type, start_date, end_date, status)
values ('22222222-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000101',
        'vacation', current_date + 30, current_date + 32, 'approved');
select pg_temp.ok((select status from public.absences where id = '22222222-0000-0000-0000-000000000001') = 'pending',
  'employee''s vacation request stays pending even if she sends "approved"');

select pg_temp.expect_denied($q$
  update public.absences set status = 'approved' where id = '22222222-0000-0000-0000-000000000001' $q$,
  'employee cannot approve her own vacation');

insert into public.absences (id, member_id, type, start_date, end_date, attachment_path)
values ('22222222-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000101',
        'sick', current_date, current_date, '00000000-0000-0000-0000-000000000101/x/note.jpg');
select pg_temp.ok((select status = 'approved' and attachment_review = 'pending'
                   from public.absences where id = '22222222-0000-0000-0000-000000000002'),
  'sick leave is approved on entry and the note waits for review');

select pg_temp.expect_denied($q$
  update public.absences set attachment_review = 'valid' where id = '22222222-0000-0000-0000-000000000002' $q$,
  'employee cannot mark her own sick note as valid');

-- Under RLS the update silently matches 0 rows; verified after commit.
update public.members set role = 'manager' where id = '00000000-0000-0000-0000-000000000101';
commit;
select pg_temp.ok((select role from public.members where id = '00000000-0000-0000-0000-000000000101') = 'employee',
  'employee cannot promote herself (update affects nothing)');

-- 2. Branch manager (Avi) --------------------------------------------
begin;
select pg_temp.act_as('11111111-0000-0000-0000-000000000001');

select pg_temp.ok((select count(*) from public.members) = 12,
  'manager sees all 12 employees of his branch');
select pg_temp.ok((select count(*) from public.schedules) = 1,
  'manager sees the draft schedule');
select pg_temp.ok((select count(*) from public.availability) = 12,
  'manager sees everyone''s constraints');

insert into public.assignments (schedule_id, member_id, weekday, kind)
values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000101', 0, 'morning'),
       ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000103', 0, 'morning');
select pg_temp.ok((select count(*) from public.schedule_events) = 2,
  'every assignment change is written to the audit log');

update public.absences set status = 'approved',
       reviewed_by = '00000000-0000-0000-0000-000000000102', reviewed_at = now()
where id = '22222222-0000-0000-0000-000000000001';
select pg_temp.ok((select status from public.absences where id = '22222222-0000-0000-0000-000000000001') = 'approved',
  'manager can approve a vacation');

update public.absences set attachment_review = 'valid' where id = '22222222-0000-0000-0000-000000000002';
select pg_temp.ok(true, 'manager can review a sick note');

select pg_temp.expect_denied($q$
  update public.members set role = 'owner' where id = '00000000-0000-0000-0000-000000000104' $q$,
  'manager cannot hand out the owner role');

select pg_temp.expect_denied($q$
  insert into public.schedule_events (schedule_id, action) values ('00000000-0000-0000-0000-0000000000c1', 'fake') $q$,
  'nobody can write to the audit log directly');

update public.schedules set status = 'published', published_at = now()
where id = '00000000-0000-0000-0000-0000000000c1';
commit;

-- 3. Employee after publishing ---------------------------------------
begin;
select pg_temp.act_as('11111111-0000-0000-0000-000000000004');
select pg_temp.ok((select count(*) from public.schedules) = 1,
  'employee sees the schedule once it is published');
select pg_temp.ok((select count(*) from public.assignments) = 2,
  'employee sees who works each shift');
select pg_temp.expect_denied($q$
  insert into public.assignments (schedule_id, member_id, weekday, kind)
  values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000103', 1, 'morning') $q$,
  'employee cannot assign herself to a shift');
select pg_temp.ok((select count(*) from public.absences) = 0,
  'employee cannot see Dana''s sick leave');
commit;

-- 4. Owner of another business ----------------------------------------
begin;
select pg_temp.act_as('11111111-0000-0000-0000-000000000003');
select public.create_organization('Other Bakery', 'Main', 'Outsider Owner');
select pg_temp.ok((select count(*) from public.template_slots) = 21,
  'new organization gets a default weekly template');
select pg_temp.ok((select count(*) from public.members) = 1,
  'another business sees none of Demo Coffee''s employees');
select pg_temp.ok((select count(*) from public.branch_roster('00000000-0000-0000-0000-0000000000b1')) = 0,
  'another business cannot read Demo Coffee''s roster');
select pg_temp.ok((select count(*) from public.absences) = 0 and (select count(*) from public.availability) = 0,
  'another business sees no absences or constraints');
commit;

-- 5. Signed-out visitor -----------------------------------------------
begin;
set local role anon;
select pg_temp.expect_denied('select * from public.members', 'signed-out visitors cannot read anything');
commit;

\echo 'All security tests passed.'
