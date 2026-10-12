-- Saving a generated schedule
--
-- apply_schedule() replaces a week's unlocked assignments with a new set in
-- one transaction, touching only what actually changed — so the audit log
-- (and the "who to notify after re-publishing" list) shows real changes only.
-- Runs with the caller's permissions: row-level security still decides.
--
-- Safe to run more than once.

create or replace function public.apply_schedule(p_schedule uuid, p_assignments jsonb)
returns integer language plpgsql security invoker set search_path = public as $$
declare v_changed integer := 0; v_n integer;
begin
  create temp table _new on commit drop as
    select distinct x.member_id, x.weekday, x.kind
    from jsonb_to_recordset(p_assignments) as x(member_id uuid, weekday smallint, kind public.shift_kind);

  delete from public.assignments a
  where a.schedule_id = p_schedule and not a.is_locked
    and not exists (select 1 from _new n
                    where n.member_id = a.member_id and n.weekday = a.weekday and n.kind = a.kind);
  get diagnostics v_n = row_count; v_changed := v_changed + v_n;

  insert into public.assignments (schedule_id, member_id, weekday, kind)
  select p_schedule, n.member_id, n.weekday, n.kind from _new n
  on conflict (schedule_id, member_id, weekday, kind) do nothing;
  get diagnostics v_n = row_count; v_changed := v_changed + v_n;

  return v_changed;
end $$;

-- People whose shifts changed since the schedule was last published.
create or replace function public.changed_since_publish(p_schedule uuid)
returns setof uuid language sql stable security invoker set search_path = public as $$
  select distinct (e.payload ->> 'member_id')::uuid
  from public.schedule_events e
  join public.schedules s on s.id = e.schedule_id
  where e.schedule_id = p_schedule and s.status = 'published'
    and e.action in ('insert', 'delete') and e.created_at > s.published_at
$$;

revoke execute on function public.apply_schedule(uuid, jsonb), public.changed_since_publish(uuid) from public, anon;
grant  execute on function public.apply_schedule(uuid, jsonb), public.changed_since_publish(uuid) to authenticated;
