-- Constraints, vacation and sick leave
--
-- 1. Employees can change their constraints only for weeks that haven't ended.
--    Managers can still correct any week.
-- 2. When an absence is approved (a vacation the manager approves, or sick
--    leave, which is approved on entry), the person is removed from any shifts
--    already assigned on those dates. The audit log records each removal, so
--    the schedule board can show what changed.

drop policy if exists avail_write on public.availability;
create policy avail_write on public.availability for all to authenticated
  using (public.manages_member(member_id)
         or (public.is_self(member_id) and week_start + 6 >= current_date))
  with check (public.manages_member(member_id)
              or (public.is_self(member_id) and week_start + 6 >= current_date));

create or replace function public.apply_approved_absence()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'approved'
     and (tg_op = 'INSERT' or old.status is distinct from 'approved'
          or old.start_date <> new.start_date or old.end_date <> new.end_date) then
    delete from public.assignments a
    using public.schedules s
    where a.schedule_id = s.id
      and a.member_id = new.member_id
      and (s.week_start + a.weekday) between new.start_date and new.end_date;
  end if;
  return null;
end $$;

create trigger trg_absences_apply after insert or update on public.absences
  for each row execute function public.apply_approved_absence();

-- Who still hasn't submitted constraints for a week (any row counts as submitted).
create or replace function public.availability_summary(p_branch uuid, p_week date)
returns table (member_id uuid, marks integer, cannot integer, prefer integer)
language sql stable security definer set search_path = public as $$
  select bm.member_id,
         count(a.*)::int,
         count(*) filter (where a.level = 'cannot')::int,
         count(*) filter (where a.level = 'prefer')::int
  from public.branch_members bm
  join public.members m on m.id = bm.member_id and m.is_active
  left join public.availability a on a.member_id = bm.member_id and a.week_start = p_week
  where bm.branch_id = p_branch and public.is_branch_manager(p_branch)
  group by bm.member_id
$$;

revoke execute on function public.availability_summary(uuid, date) from public, anon;
grant  execute on function public.availability_summary(uuid, date) to authenticated;
