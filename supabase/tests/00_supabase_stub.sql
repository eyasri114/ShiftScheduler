-- Minimal stand-in for the parts of Supabase the schema relies on, so the
-- migrations and security tests can run on plain PostgreSQL (CI, local).
-- NOT applied to a real Supabase project.

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon')          then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;

create schema if not exists auth;
create table if not exists auth.users (
  id    uuid primary key,
  email text,
  phone text
);

-- Same logic as Supabase's auth.uid(): reads the "sub" claim of the JWT.
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

grant usage on schema auth, public to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;

-- Same as Supabase's auth.jwt(): the decoded JWT claims of the request.
create or replace function auth.jwt() returns jsonb language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
grant execute on function auth.jwt() to anon, authenticated;
