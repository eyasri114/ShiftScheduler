-- Sign-in linking tests. Run after 01_security_test.sql.
\set ON_ERROR_STOP on

create or replace function pg_temp.act_as(p_user uuid, p_email text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'email', p_email, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
end $$;
create or replace function pg_temp.ok(p_cond boolean, p_label text) returns void language plpgsql as $$
begin
  if p_cond then raise notice 'PASS  %', p_label; else raise exception 'FAIL  %', p_label; end if;
end $$;

update public.members set email = 'Shira@Example.com' where id = '00000000-0000-0000-0000-000000000107';
insert into auth.users (id, email) values
  ('33333333-0000-0000-0000-000000000001', 'shira@example.com'),
  ('33333333-0000-0000-0000-000000000002', 'stranger@example.com');

begin;
select pg_temp.act_as('33333333-0000-0000-0000-000000000002', 'stranger@example.com');
select pg_temp.ok(public.claim_membership() = 0, 'a stranger''s email links to nobody');
select pg_temp.ok(public.my_context() is null, 'a stranger has no business yet (goes to onboarding)');
commit;

begin;
select pg_temp.act_as('33333333-0000-0000-0000-000000000001', 'shira@example.com');
select pg_temp.ok(public.claim_membership() = 1, 'an invited employee is linked by email (case-insensitive)');
select pg_temp.ok(public.claim_membership() = 0, 'linking twice does nothing');
select pg_temp.ok((public.my_context() ->> 'full_name') = 'שירה דהן'
                  and (public.my_context() ->> 'role') = 'employee'
                  and jsonb_array_length(public.my_context() -> 'branches') = 1,
  'my_context returns her name, role and branch');
commit;

begin;
select pg_temp.act_as('11111111-0000-0000-0000-000000000001', 'avi.manager@test');
select pg_temp.ok((public.my_context() ->> 'role') = 'manager', 'the manager''s context says manager');
commit;

begin;
set local role anon;
do $$ begin
  perform public.my_context();
  raise exception 'FAIL  signed-out visitors cannot call my_context';
exception when insufficient_privilege then raise notice 'PASS  signed-out visitors cannot call my_context';
end $$;
commit;

\echo 'All sign-in tests passed.'
