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
