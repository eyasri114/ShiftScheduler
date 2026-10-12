-- Notifications. Run after 05_schedule_test.sql.
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

-- Dana (employee, user …0002) registers her phone
begin;
select pg_temp.act_as('11111111-0000-0000-0000-000000000002');
insert into public.push_subscriptions (member_id, endpoint, p256dh, auth)
values ('00000000-0000-0000-0000-000000000101', 'https://push.example/dana', 'k', 'a');
select pg_temp.ok(true, 'an employee can register her own phone for alerts');
select pg_temp.expect_denied($q$
  insert into public.push_subscriptions (member_id, endpoint, p256dh, auth)
  values ('00000000-0000-0000-0000-000000000103', 'https://push.example/fake', 'k', 'a') $q$,
  'an employee cannot register a phone for someone else');
select pg_temp.expect_denied($q$
  insert into public.notifications (member_id, kind, title) values ('00000000-0000-0000-0000-000000000103', 'x', 'spam') $q$,
  'nobody can write notifications directly');
-- Dana tries to notify a coworker through the manager-only function
select pg_temp.ok((select count(*) from public.notify_members(array['00000000-0000-0000-0000-000000000103']::uuid[], 'x', 'spam', null, null)) = 0
  and (select count(*) from public.notifications) = 0,
  'an employee cannot notify coworkers');
-- Dana reports something → her branch manager (Avi) is notified
select pg_temp.ok((select count(*) from public.notify_branch_managers('absence_request', 'בקשת חופשה מדנה', null, '/absences')) >= 0,
  'an employee can notify her branch managers');
commit;

-- Avi (manager) sees it, then notifies Dana and Maya (no phone) about the schedule
begin;
select pg_temp.act_as('11111111-0000-0000-0000-000000000001');
select pg_temp.ok((select count(*) from public.notifications where title = 'בקשת חופשה מדנה') = 1,
  'the branch manager received the employee''s request');
select pg_temp.ok((select array_agg(endpoint) from public.notify_members(
    array['00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000103']::uuid[],
    'schedule_published', 'הסידור פורסם', null, '/schedule')) = array['https://push.example/dana'],
  'notifying two employees returns only the phones that exist (Dana''s)');
select pg_temp.ok((select count(*) from public.push_subscriptions) = 0,
  'a manager cannot read employees'' phone subscriptions directly');
commit;

begin;
select pg_temp.act_as('11111111-0000-0000-0000-000000000002');
select pg_temp.ok((select count(*) from public.notifications where read_at is null) = 1,
  'Dana sees her one unread notification');
update public.notifications set read_at = now();
select pg_temp.ok((select count(*) from public.notifications where read_at is null) = 0,
  'Dana can mark her notifications as read');
commit;

-- Another business can't reach Demo Coffee people
begin;
select pg_temp.act_as('11111111-0000-0000-0000-000000000003');
select pg_temp.ok((select count(*) from public.notify_members(array['00000000-0000-0000-0000-000000000101']::uuid[], 'x', 'spam', null, null)) = 0,
  'another business cannot notify Demo Coffee employees');
commit;
select pg_temp.ok((select count(*) from public.notifications where title = 'spam') = 0, 'no spam was stored');

\echo 'All notification tests passed.'
