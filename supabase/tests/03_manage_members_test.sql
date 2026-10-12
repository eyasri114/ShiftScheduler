-- Managing employees. Run after 02_auth_test.sql.
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
create or replace function pg_temp.expect_error(p_sql text, p_code text, p_label text) returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when others then
    if sqlstate = p_code then raise notice 'PASS  %', p_label; return; end if;
    raise exception 'FAIL  % — got % %', p_label, sqlstate, sqlerrm;
  end;
  raise exception 'FAIL  % — expected an error', p_label;
end $$;

-- Avi (manager of the demo branch) adds an employee
begin;
select pg_temp.act_as('11111111-0000-0000-0000-000000000001');
select pg_temp.ok(public.add_branch_member('00000000-0000-0000-0000-0000000000b1',
  '{"full_name":"ליאור חדש","email":"Lior@Example.com","birth_date":"2009-02-01","allowed_kinds":["morning"],"rest_weekday":"6","min_shifts":"1","max_shifts":"3"}') is not null,
  'a manager can add an employee to his branch');
select pg_temp.ok((select lower(email) = 'lior@example.com' and allowed_kinds = '{morning}' and rest_weekday = 6
                     and role = 'employee' and max_shifts = 3
                   from public.members where full_name = 'ליאור חדש'),
  'the new employee is saved with all fields and visible to the manager');
select pg_temp.expect_error($q$ select public.add_branch_member('00000000-0000-0000-0000-0000000000b1',
  '{"full_name":"כפול","email":"lior@example.com"}') $q$, '23505',
  'the same email cannot be added twice in one business');
select pg_temp.expect_error($q$ select public.add_branch_member('00000000-0000-0000-0000-0000000000b1',
  '{"full_name":"מנהל חדש","role":"manager"}') $q$, '42501',
  'a manager cannot create another manager');
select pg_temp.expect_error($q$ select public.add_branch_member('00000000-0000-0000-0000-0000000000b1',
  '{"full_name":"טווח שגוי","min_shifts":"5","max_shifts":"2"}') $q$, '23514',
  'minimum shifts above maximum is refused');
update public.members set is_active = false where full_name = 'ליאור חדש';
select pg_temp.ok((select not is_active from public.members where full_name = 'ליאור חדש'),
  'a manager can mark an employee inactive');
commit;

-- Dana (employee) cannot add anyone
begin;
select pg_temp.act_as('11111111-0000-0000-0000-000000000002');
select pg_temp.expect_error($q$ select public.add_branch_member('00000000-0000-0000-0000-0000000000b1',
  '{"full_name":"פורץ"}') $q$, '42501', 'an employee cannot add employees');
commit;

-- The owner of another business cannot add to this branch
begin;
select pg_temp.act_as('11111111-0000-0000-0000-000000000003');
select pg_temp.expect_error($q$ select public.add_branch_member('00000000-0000-0000-0000-0000000000b1',
  '{"full_name":"זר"}') $q$, '42501', 'another business cannot add employees to this branch');
-- …but the owner of a business can create managers in their own
select pg_temp.ok(public.add_branch_member((select id from public.branches where name = 'Main'),
  '{"full_name":"Manager Two","role":"manager"}') is not null, 'an owner can create a manager');
commit;

\echo 'All employee-management tests passed.'
