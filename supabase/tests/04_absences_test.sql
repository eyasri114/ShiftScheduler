-- Constraints and absences. Run after 03_manage_members_test.sql.
\set ON_ERROR_STOP on

create or replace function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.ok(p_cond boolean, p_label text) returns void language plpgsql as $$
begin
  if p_cond then raise notice 'PASS  %', p_label; else raise exception 'FAIL  %', p_label; end if;
end $$;
create or replace function pg_temp.expect_denied(p_sql text, p_label text) returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when insufficient_privilege or check_violation then raise notice 'PASS  %', p_label; return; end;
  raise exception 'FAIL  % — expected the database to refuse', p_label;
end $$;

-- Maya (employee 103) is assigned to Sunday and Monday mornings of next week.
insert into public.assignments (schedule_id, member_id, weekday, kind) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000103', 1, 'morning'),
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-000000000103', 3, 'evening');

-- Employee: constraints for past weeks are locked
begin;
select pg_temp.act_as('11111111-0000-0000-0000-000000000004');
select pg_temp.expect_denied($q$
  insert into public.availability (member_id, week_start, weekday, kind, level)
  values ('00000000-0000-0000-0000-000000000103',
          current_date - extract(dow from current_date)::int - 14, 1, 'morning', 'cannot') $q$,
  'an employee cannot change constraints for a week that already ended');
insert into public.availability (member_id, week_start, weekday, kind, level)
values ('00000000-0000-0000-0000-000000000103',
        current_date - extract(dow from current_date)::int, 6, 'evening', 'prefer')
on conflict (member_id, week_start, weekday, kind) do update set level = excluded.level;
select pg_temp.ok(true, 'an employee can still mark the current week');
select pg_temp.ok((select count(*) from public.availability_summary('00000000-0000-0000-0000-0000000000b1',
                     current_date + (7 - extract(dow from current_date)::int))) = 0,
  'an employee cannot read the team''s constraint summary');

-- Maya asks for vacation covering Monday of next week
insert into public.absences (id, member_id, type, start_date, end_date)
values ('55555555-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000103', 'vacation',
        current_date + (7 - extract(dow from current_date)::int) + 1,
        current_date + (7 - extract(dow from current_date)::int) + 1);
commit;

select pg_temp.ok((select array_agg(weekday order by weekday) from public.assignments
                   where member_id = '00000000-0000-0000-0000-000000000103') = '{0,1,3}',
  'a pending vacation does not remove assigned shifts');

-- Manager approves → Monday shift removed, Wednesday kept, removal logged
begin;
select pg_temp.act_as('11111111-0000-0000-0000-000000000001');
update public.absences set status = 'approved' where id = '55555555-0000-0000-0000-000000000001';
select pg_temp.ok((select array_agg(weekday order by weekday) from public.assignments
                   where member_id = '00000000-0000-0000-0000-000000000103') = '{0,3}',
  'approving a vacation removes only the shifts on those dates');
select pg_temp.ok(exists (select 1 from public.schedule_events
                          where action = 'delete' and payload ->> 'member_id' = '00000000-0000-0000-0000-000000000103'),
  'the removal is recorded in the audit log');
select pg_temp.ok((select marks from public.availability_summary('00000000-0000-0000-0000-0000000000b1',
                     current_date + (7 - extract(dow from current_date)::int))
                   where member_id = '00000000-0000-0000-0000-000000000101') >= 2,
  'the manager sees how many constraints each employee submitted');
insert into public.availability (member_id, week_start, weekday, kind, level)
values ('00000000-0000-0000-0000-000000000103',
        current_date - extract(dow from current_date)::int - 14, 1, 'morning', 'cannot');
select pg_temp.ok(true, 'a manager can still correct an old week');
commit;

-- Sick leave reported by the employee removes that day's shift immediately
begin;
select pg_temp.act_as('11111111-0000-0000-0000-000000000004');
insert into public.absences (member_id, type, start_date, end_date)
values ('00000000-0000-0000-0000-000000000103', 'sick',
        current_date + (7 - extract(dow from current_date)::int) + 3,
        current_date + (7 - extract(dow from current_date)::int) + 3);
commit;
select pg_temp.ok((select array_agg(weekday order by weekday) from public.assignments
                   where member_id = '00000000-0000-0000-0000-000000000103') = '{0}',
  'reporting sick removes that day''s shift right away');

\echo 'All constraint and absence tests passed.'
