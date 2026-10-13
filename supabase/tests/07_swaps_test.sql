-- Shift swaps. Run after 06_notifications_test.sql.
-- People with accounts: Avi 102 (manager, user …0001), Dana 101 (…0002), Maya 103 (…0004), Shira 107 (3333…0001)
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
  exception when insufficient_privilege then raise notice 'PASS  %', p_label; return; end;
  raise exception 'FAIL  % — expected the database to refuse', p_label;
end $$;

-- A published week three weeks out
insert into public.schedules (id, branch_id, week_start, status, published_at)
values ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-0000000000b1',
        current_date + (21 - extract(dow from current_date)::int), 'published', now() - interval '1 minute');
insert into public.assignments (schedule_id, member_id, weekday, kind) values
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-000000000101', 0, 'morning'),  -- Dana  Sun morning
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-000000000103', 1, 'morning'),  -- Maya  Mon morning
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-000000000107', 2, 'evening'),  -- Shira Tue evening
  ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-000000000102', 3, 'morning');  -- Avi   Wed morning
select pg_sleep(0.01);
update public.schedules set published_at = now() where id = '00000000-0000-0000-0000-0000000000c3';  -- published after the shifts were set
insert into public.availability (member_id, week_start, weekday, kind, level)
values ('00000000-0000-0000-0000-000000000103', current_date + (21 - extract(dow from current_date)::int), 0, 'morning', 'cannot');

-- Rules, checked directly (as the database owner)
select pg_temp.ok(public._shift_problem('00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-0000000000c3', 5, 'morning') like '%מנוחה הקבוע%',
  'rule: nobody works on their fixed rest day');
select pg_temp.ok(public._shift_problem('00000000-0000-0000-0000-000000000112', '00000000-0000-0000-0000-0000000000c3', 6, 'night') like '%מנוחה הקבוע%',
  'rule: a Saturday night shift running into a Sunday rest day is refused');
select pg_temp.ok(public._shift_problem('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-0000000000c3', 0, 'morning') like '%לא יכול%',
  'rule: a "can''t" constraint is respected');
select pg_temp.ok(public._shift_problem('00000000-0000-0000-0000-000000000107', '00000000-0000-0000-0000-0000000000c3', 3, 'morning') is null,
  'rule: evening → next morning (8 hours) is allowed with an 8-hour minimum');
update public.branches set min_rest_hours = 12 where id = '00000000-0000-0000-0000-0000000000b1';
select pg_temp.ok(public._shift_problem('00000000-0000-0000-0000-000000000107', '00000000-0000-0000-0000-0000000000c3', 3, 'morning') like '%שעות מנוחה%',
  'rule: …and refused with a 12-hour minimum');
update public.branches set min_rest_hours = 8 where id = '00000000-0000-0000-0000-0000000000b1';
select pg_temp.ok(public._shift_problem('00000000-0000-0000-0000-000000000107', '00000000-0000-0000-0000-0000000000c3', 2, 'morning') like '%באותו יום%',
  'rule: one shift per day');

-- Dana looks at options for her Sunday morning
begin;
select pg_temp.act_as('11111111-0000-0000-0000-000000000002');
select pg_temp.ok((select not can_take from public.swap_options('00000000-0000-0000-0000-0000000000c3', 0, 'morning')
                   where member_id = '00000000-0000-0000-0000-000000000103'),
  'options: Maya can''t take Dana''s shift (she marked can''t)');
select pg_temp.ok((select can_take and exchange @> '[{"weekday":2,"kind":"evening"}]'
                   from public.swap_options('00000000-0000-0000-0000-0000000000c3', 0, 'morning')
                   where member_id = '00000000-0000-0000-0000-000000000107'),
  'options: Shira can take it, or swap it for her Tuesday evening');
select pg_temp.ok((select count(*) from public.swap_options('00000000-0000-0000-0000-0000000000c3', 1, 'morning')) = 0,
  'options: nothing offered for a shift that isn''t yours');
select pg_temp.ok(not (public.request_swap('00000000-0000-0000-0000-0000000000c3', 0, 'morning',
                       '00000000-0000-0000-0000-000000000103') ->> 'ok')::boolean,
  'request: giving a shift to someone who can''t work it is refused');
select pg_temp.ok((public.request_swap('00000000-0000-0000-0000-0000000000c3', 0, 'morning',
                   '00000000-0000-0000-0000-000000000107', 2, 'evening', 'יש לי תור לרופא') ->> 'ok')::boolean,
  'request: Dana asks Shira to swap Sunday morning for Tuesday evening');
select pg_temp.ok(not (public.request_swap('00000000-0000-0000-0000-0000000000c3', 0, 'morning',
                       '00000000-0000-0000-0000-000000000107') ->> 'ok')::boolean,
  'request: a second open request for the same shift is refused');
select pg_temp.expect_denied($q$ insert into public.shift_swaps (schedule_id, requester_id, from_weekday, from_kind, target_id, status)
  values ('00000000-0000-0000-0000-0000000000c3', '00000000-0000-0000-0000-000000000101', 0, 'morning',
          '00000000-0000-0000-0000-000000000107', 'approved') $q$,
  'nobody can write swaps directly (only through the checked functions)');
select pg_temp.expect_denied($q$ select public._shift_problem('00000000-0000-0000-0000-000000000103',
  '00000000-0000-0000-0000-0000000000c3', 0, 'morning') $q$,
  'employees can''t probe coworkers'' constraints through the rule checker');
commit;

-- Maya can't see or answer it
begin;
select pg_temp.act_as('11111111-0000-0000-0000-000000000004');
select pg_temp.ok((select count(*) from public.shift_swaps) = 0, 'privacy: an uninvolved coworker can''t see the request');
select pg_temp.expect_denied($q$ select public.respond_swap((select id from public.shift_swaps limit 1), true) $q$,
  'an uninvolved coworker can''t answer it');
commit;

-- Shira accepts → waits for the manager (default mode)
begin;
select pg_temp.act_as('33333333-0000-0000-0000-000000000001');
select pg_temp.ok((select count(*) from public.notifications where kind = 'swap_requested') = 1, 'Shira was notified');
select pg_temp.ok((public.respond_swap((select id from public.shift_swaps where status = 'pending_peer'), true) ->> 'ok')::boolean,
  'Shira accepts');
commit;
select pg_temp.ok((select status from public.shift_swaps where requester_id = '00000000-0000-0000-0000-000000000101') = 'pending_manager'
  and exists (select 1 from public.assignments where schedule_id = '00000000-0000-0000-0000-0000000000c3'
              and member_id = '00000000-0000-0000-0000-000000000101' and weekday = 0),
  'manager mode: nothing changes until the manager approves');

begin;
select pg_temp.act_as('11111111-0000-0000-0000-000000000002');
select pg_temp.expect_denied($q$ select public.decide_swap((select id from public.shift_swaps limit 1), true) $q$,
  'an employee can''t approve her own swap');
commit;

begin;
select pg_temp.act_as('11111111-0000-0000-0000-000000000001');
select pg_temp.ok((select count(*) from public.notifications where kind = 'swap_needs_approval') = 1, 'the manager was notified');
select pg_temp.ok((public.decide_swap((select id from public.shift_swaps where status = 'pending_manager'), true) ->> 'ok')::boolean,
  'the manager approves');
commit;
select pg_temp.ok(
  exists (select 1 from public.assignments where schedule_id = '00000000-0000-0000-0000-0000000000c3'
          and member_id = '00000000-0000-0000-0000-000000000107' and weekday = 0 and kind = 'morning' and is_locked)
  and exists (select 1 from public.assignments where schedule_id = '00000000-0000-0000-0000-0000000000c3'
          and member_id = '00000000-0000-0000-0000-000000000101' and weekday = 2 and kind = 'evening' and is_locked),
  'the shifts are swapped and locked against auto-scheduling');
select pg_temp.ok((select count(*) from public.changed_since_publish('00000000-0000-0000-0000-0000000000c3')) = 0,
  'an agreed swap doesn''t count as an unpublished change');
select pg_temp.ok(exists (select 1 from public.schedule_events where schedule_id = '00000000-0000-0000-0000-0000000000c3'
                          and payload ->> 'from_member_id' = '00000000-0000-0000-0000-000000000101'),
  'the audit log records who the shift moved from');

-- Automatic mode
update public.branches set swap_approval = 'auto' where id = '00000000-0000-0000-0000-0000000000b1';
begin;
select pg_temp.act_as('11111111-0000-0000-0000-000000000004');  -- Maya gives Monday morning to Dana
select pg_temp.ok((public.request_swap('00000000-0000-0000-0000-0000000000c3', 1, 'morning',
                   '00000000-0000-0000-0000-000000000101') ->> 'ok')::boolean, 'auto mode: Maya offers Dana her Monday morning');
commit;
begin;
select pg_temp.act_as('11111111-0000-0000-0000-000000000002');
select pg_temp.ok((public.respond_swap((select id from public.shift_swaps where status = 'pending_peer'), true) ->> 'ok')::boolean,
  'auto mode: Dana accepts');
commit;
select pg_temp.ok(exists (select 1 from public.assignments where schedule_id = '00000000-0000-0000-0000-0000000000c3'
                          and member_id = '00000000-0000-0000-0000-000000000101' and weekday = 1 and kind = 'morning'),
  'auto mode: the shift moves immediately, no manager step');
select pg_temp.ok((select count(*) from public.notifications n join public.members m on m.id = n.member_id
                   where n.kind = 'swap_done' and m.id = '00000000-0000-0000-0000-000000000102') >= 1,
  'auto mode: the manager is told it happened');

-- A rule that breaks between request and acceptance stops the swap
begin;
select pg_temp.act_as('33333333-0000-0000-0000-000000000001');  -- Shira offers Sunday morning to Avi
select pg_temp.ok((public.request_swap('00000000-0000-0000-0000-0000000000c3', 0, 'morning',
                   '00000000-0000-0000-0000-000000000102') ->> 'ok')::boolean, 'Shira offers Avi her Sunday morning');
commit;
insert into public.availability (member_id, week_start, weekday, kind, level)
values ('00000000-0000-0000-0000-000000000102', current_date + (21 - extract(dow from current_date)::int), 0, 'morning', 'cannot');
begin;
select pg_temp.act_as('11111111-0000-0000-0000-000000000001');
select pg_temp.ok(not (public.respond_swap((select id from public.shift_swaps where status = 'pending_peer'), true) ->> 'ok')::boolean,
  'accepting is refused when it would now break a rule');
commit;
select pg_temp.ok((select status from public.shift_swaps where requester_id = '00000000-0000-0000-0000-000000000107'
                   order by created_at desc limit 1) = 'failed'
  and exists (select 1 from public.assignments where schedule_id = '00000000-0000-0000-0000-0000000000c3'
              and member_id = '00000000-0000-0000-0000-000000000107' and weekday = 0),
  '…the request is marked failed and the shift stays with Shira');

-- Cancelling
begin;
select pg_temp.act_as('11111111-0000-0000-0000-000000000002');  -- Dana offers Tuesday evening to Shira, then cancels
select pg_temp.ok((public.request_swap('00000000-0000-0000-0000-0000000000c3', 2, 'evening',
                   '00000000-0000-0000-0000-000000000107') ->> 'ok')::boolean, 'Dana offers her Tuesday evening');
select pg_temp.ok((public.cancel_swap((select id from public.shift_swaps where status = 'pending_peer')) ->> 'ok')::boolean,
  'Dana cancels her own request');
commit;
begin;
select pg_temp.act_as('11111111-0000-0000-0000-000000000003');
select pg_temp.ok((select count(*) from public.swap_options('00000000-0000-0000-0000-0000000000c3', 0, 'morning')) = 0
                  and (select count(*) from public.shift_swaps) = 0,
  'another business sees nothing');
commit;
update public.branches set swap_approval = 'manager' where id = '00000000-0000-0000-0000-0000000000b1';

\echo 'All swap tests passed.'
