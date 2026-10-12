-- Saving and publishing schedules. Run after 04_absences_test.sql.
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

-- A fresh draft week for the demo branch, two weeks out
insert into public.schedules (id, branch_id, week_start)
values ('00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000b1',
        current_date + (14 - extract(dow from current_date)::int));

begin;
select pg_temp.act_as('11111111-0000-0000-0000-000000000001');  -- Avi, manager
select pg_temp.ok(public.apply_schedule('00000000-0000-0000-0000-0000000000c2',
  '[{"member_id":"00000000-0000-0000-0000-000000000104","weekday":0,"kind":"morning"},
    {"member_id":"00000000-0000-0000-0000-000000000106","weekday":0,"kind":"morning"},
    {"member_id":"00000000-0000-0000-0000-000000000107","weekday":1,"kind":"evening"}]') = 3,
  'a manager saves a generated schedule');
update public.assignments set is_locked = true
where schedule_id = '00000000-0000-0000-0000-0000000000c2' and member_id = '00000000-0000-0000-0000-000000000107';
update public.schedules set status = 'published', published_at = now() where id = '00000000-0000-0000-0000-0000000000c2';
commit;

-- Re-running with a different set changes only the differences and keeps the locked shift
select pg_sleep(0.01);
begin;
select pg_temp.act_as('11111111-0000-0000-0000-000000000001');
select pg_temp.ok(public.apply_schedule('00000000-0000-0000-0000-0000000000c2',
  '[{"member_id":"00000000-0000-0000-0000-000000000104","weekday":0,"kind":"morning"},
    {"member_id":"00000000-0000-0000-0000-000000000109","weekday":0,"kind":"morning"}]') = 2,
  'saving again only changes what is different (one out, one in)');
select pg_temp.ok((select count(*) from public.assignments where schedule_id = '00000000-0000-0000-0000-0000000000c2'
                   and member_id = '00000000-0000-0000-0000-000000000107' and is_locked) = 1,
  'a locked shift survives re-scheduling');
select pg_temp.ok((select array_agg(x order by x) from public.changed_since_publish('00000000-0000-0000-0000-0000000000c2') x)
                  = array['00000000-0000-0000-0000-000000000106','00000000-0000-0000-0000-000000000109']::uuid[],
  'only the two people whose shifts changed need to be told');
commit;

-- An employee cannot rewrite the schedule
begin;
select pg_temp.act_as('11111111-0000-0000-0000-000000000004');  -- Maya, employee
do $$ begin
  perform public.apply_schedule('00000000-0000-0000-0000-0000000000c2',
    '[{"member_id":"00000000-0000-0000-0000-000000000103","weekday":2,"kind":"morning"}]');
  raise exception 'FAIL  an employee cannot rewrite the schedule';
exception when insufficient_privilege then raise notice 'PASS  an employee cannot rewrite the schedule';
end $$;
commit;
select pg_temp.ok((select count(*) from public.assignments where schedule_id = '00000000-0000-0000-0000-0000000000c2') = 3,
  'the schedule is unchanged after the employee''s attempt');

\echo 'All schedule tests passed.'
