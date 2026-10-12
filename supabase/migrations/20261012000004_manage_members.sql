-- Managing employees from the app
--
-- add_branch_member(): creates an employee and puts them in a branch in one
-- step. (Two separate inserts would fail: until the branch link exists, the
-- manager isn't allowed to see the new record.)
--
-- Only owners can make someone a manager.

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
  if new.role = 'manager' and (tg_op = 'INSERT' or old.role <> 'manager')
     and not public.is_org_owner(new.org_id) then
    raise exception 'Only an owner can make someone a manager' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and old.role = 'manager' and new.role <> 'manager'
     and not public.is_org_owner(new.org_id) then
    raise exception 'Only an owner can change a manager''s role' using errcode = '42501';
  end if;
  return new;
end $$;

create or replace function public.add_branch_member(p_branch uuid, p_member jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid; v_id uuid;
begin
  if not public.is_branch_manager(p_branch) then
    raise exception 'Only a manager of this branch can add employees' using errcode = '42501';
  end if;
  select org_id into v_org from public.branches where id = p_branch;

  insert into public.members (
    org_id, full_name, email, phone, birth_date, role, is_shift_lead,
    allowed_kinds, rest_weekday, min_shifts, max_shifts)
  values (
    v_org,
    trim(p_member ->> 'full_name'),
    nullif(lower(trim(p_member ->> 'email')), ''),
    nullif(trim(p_member ->> 'phone'), ''),
    nullif(p_member ->> 'birth_date', '')::date,
    coalesce(nullif(p_member ->> 'role', ''), 'employee')::public.member_role,
    coalesce((p_member ->> 'is_shift_lead')::boolean, false),
    coalesce((select array_agg(k::public.shift_kind)
              from jsonb_array_elements_text(p_member -> 'allowed_kinds') k),
             '{morning,evening,night}'),
    nullif(p_member ->> 'rest_weekday', '')::smallint,
    coalesce(nullif(p_member ->> 'min_shifts', '')::smallint, 0),
    coalesce(nullif(p_member ->> 'max_shifts', '')::smallint, 5))
  returning id into v_id;

  insert into public.branch_members (branch_id, member_id) values (p_branch, v_id);
  return v_id;
end $$;

revoke execute on function public.add_branch_member(uuid, jsonb) from public, anon;
grant  execute on function public.add_branch_member(uuid, jsonb) to authenticated;
