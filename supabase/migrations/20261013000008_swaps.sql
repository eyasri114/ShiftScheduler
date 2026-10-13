-- Shift swaps between employees
--
-- An employee can
--   * give away a shift to a coworker, or
--   * exchange a shift with a coworker's shift.
-- The coworker accepts or declines. Then, per branch setting:
--   swap_approval = 'manager'  → the manager approves or rejects
--   swap_approval = 'auto'     → it happens immediately
-- Either way, the swap only happens if both people still satisfy every
-- scheduling rule (the same hard rules as the scheduling engine), checked in
-- the database at the moment it executes. Swapped shifts are locked so
-- auto-scheduling won't undo an agreed swap.
--
-- Employees never touch shift_swaps or assignments directly: everything goes
-- through the functions below, which check who is allowed to do what.
--
-- Safe to run more than once.

alter table public.branches add column if not exists swap_approval text not null default 'manager';
do $$ begin
  alter table public.branches add constraint branches_swap_approval_check check (swap_approval in ('manager', 'auto'));
exception when duplicate_object then null; end $$;

create table if not exists public.shift_swaps (
  id              uuid primary key default gen_random_uuid(),
  schedule_id     uuid not null references public.schedules(id) on delete cascade,
  requester_id    uuid not null references public.members(id) on delete cascade,
  from_weekday    smallint not null check (from_weekday between 0 and 6),
  from_kind       public.shift_kind not null,
  target_id       uuid not null references public.members(id) on delete cascade,
  to_weekday      smallint check (to_weekday between 0 and 6),   -- null = give away
  to_kind         public.shift_kind,
  note            text,
  status          text not null default 'pending_peer'
                  check (status in ('pending_peer', 'pending_manager', 'approved', 'rejected', 'declined', 'cancelled', 'failed')),
  failure_reason  text,
  decided_by      uuid references public.members(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  check ((to_weekday is null) = (to_kind is null)),
  check (requester_id <> target_id)
);
create index if not exists shift_swaps_schedule_idx on public.shift_swaps (schedule_id, status);
create index if not exists shift_swaps_target_idx on public.shift_swaps (target_id, status);
create index if not exists shift_swaps_requester_idx on public.shift_swaps (requester_id, status);

alter table public.shift_swaps enable row level security;
drop policy if exists swaps_select on public.shift_swaps;
create policy swaps_select on public.shift_swaps for select to authenticated
  using (public.is_self(requester_id) or public.is_self(target_id) or public.manages_member(requester_id));
revoke all on public.shift_swaps from anon;
revoke insert, update, delete on public.shift_swaps from authenticated;
grant select on public.shift_swaps to authenticated;

drop trigger if exists trg_swaps_touch on public.shift_swaps;
create trigger trg_swaps_touch before update on public.shift_swaps
  for each row execute function public.touch_updated_at();

-- The audit log now also records who a shift moved from.
create or replace function public.log_assignment()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record := coalesce(new, old);
begin
  insert into public.schedule_events (schedule_id, actor_user, action, payload)
  values (r.schedule_id, auth.uid(), lower(tg_op),
          jsonb_build_object('member_id', r.member_id, 'weekday', r.weekday, 'kind', r.kind,
                             'is_locked', r.is_locked,
                             'from_member_id', case when tg_op = 'UPDATE' and old.member_id <> new.member_id
                                                    then old.member_id end));
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Internal helpers (not callable from the app)
-- ---------------------------------------------------------------------------

-- Minutes from Sunday 00:00 of the week to the start and end of a shift.
create or replace function public._slot_bounds(p_branch uuid, p_weekday int, p_kind public.shift_kind,
  out s int, out e int)
language sql stable set search_path = public as $$
  select p_weekday * 1440 + (extract(epoch from t.start_time) / 60)::int,
         p_weekday * 1440 + (extract(epoch from t.start_time) / 60)::int
           + case when t.end_time > t.start_time then (extract(epoch from t.end_time - t.start_time) / 60)::int
                  else 1440 - (extract(epoch from t.start_time - t.end_time) / 60)::int end
  from public.template_slots t
  where t.branch_id = p_branch and t.weekday = p_weekday and t.kind = p_kind
$$;

create or replace function public._shift_label(p_week date, p_weekday int, p_kind public.shift_kind)
returns text language sql stable as $$
  select (array['בוקר', 'ערב', 'לילה'])[case p_kind when 'morning' then 1 when 'evening' then 2 else 3 end]
    || ', יום ' || (array['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'])[p_weekday + 1]
    || ' ' || extract(day from p_week + p_weekday)::int || '.' || extract(month from p_week + p_weekday)::int
$$;

/*
  Why p_member can't work (p_weekday, p_kind) in this schedule, or null.
  Their other shifts that week count, except the one they'd hand over
  (p_drop_*). Mirrors violation() in src/lib/scheduler/engine.ts.
*/
create or replace function public._shift_problem(p_member uuid, p_schedule uuid, p_weekday int, p_kind public.shift_kind,
  p_drop_weekday int default null, p_drop_kind public.shift_kind default null)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  m public.members; sc public.schedules; br public.branches;
  d date; ns int; ne int; r int; cnt int := 0; gap int; maxgap int; o record;
begin
  select * into m from public.members where id = p_member;
  select * into sc from public.schedules where id = p_schedule;
  if m.id is null or sc.id is null then return 'לא נמצא'; end if;
  select * into br from public.branches where id = sc.branch_id;
  if not m.is_active then return 'העובד/ת לא פעיל/ה'; end if;
  if not exists (select 1 from public.branch_members where branch_id = br.id and member_id = m.id) then
    return 'לא עובד/ת בסניף הזה';
  end if;

  d := sc.week_start + p_weekday;
  select b.s, b.e into ns, ne from public._slot_bounds(br.id, p_weekday, p_kind) b;
  if ns is null then return 'אין משמרת כזו'; end if;

  if exists (select 1 from public.absences a where a.member_id = m.id and a.status = 'approved'
             and d between a.start_date and a.end_date) then
    return 'בחופשה או במחלה';
  end if;
  if m.rest_weekday is not null then
    r := m.rest_weekday * 1440;
    if (ns < r + 1440 and ne > r) or (ns < r + 10080 + 1440 and ne > r + 10080) then
      return 'יום המנוחה הקבוע שלו/ה';
    end if;
  end if;
  if exists (select 1 from public.availability v where v.member_id = m.id and v.week_start = sc.week_start
             and v.weekday = p_weekday and v.kind = p_kind and v.level = 'cannot') then
    return 'סימן/ה שלא יכול/ה להגיע';
  end if;
  if not (p_kind = any (m.allowed_kinds)) then return 'לא מוגדר/ת למשמרת כזו'; end if;
  if m.birth_date is not null and d < (m.birth_date + interval '18 years')::date
     and ((ns % 1440) < 360 or (ns % 1440) + (ne - ns) > 1320) then
    return 'קטין/ה: אסור לעבוד בין 22:00 ל-06:00';
  end if;

  for o in
    select b.s, b.e, a.weekday
    from public.assignments a cross join lateral public._slot_bounds(br.id, a.weekday, a.kind) b
    where a.schedule_id = sc.id and a.member_id = m.id and b.s is not null
      and not (a.weekday = p_weekday and a.kind = p_kind)
      and not (p_drop_weekday is not null and a.weekday = p_drop_weekday and a.kind = p_drop_kind)
  loop
    cnt := cnt + 1;
    if o.weekday = p_weekday then return 'כבר משובץ/ת באותו יום'; end if;
    gap := case when o.e <= ns then ns - o.e when ne <= o.s then o.s - ne else -1 end;
    if gap < 0 then return 'חופף למשמרת אחרת'; end if;
    if gap < br.min_rest_hours * 60 then
      return format('רק %s שעות מנוחה בין משמרות', round(gap / 60.0, 1));
    end if;
  end loop;
  if cnt + 1 > m.max_shifts then return format('מעל המקסימום (%s משמרות)', m.max_shifts); end if;

  with iv as (
    select b.s, b.e
    from public.assignments a cross join lateral public._slot_bounds(br.id, a.weekday, a.kind) b
    where a.schedule_id = sc.id and a.member_id = m.id and b.s is not null
      and not (a.weekday = p_weekday and a.kind = p_kind)
      and not (p_drop_weekday is not null and a.weekday = p_drop_weekday and a.kind = p_drop_kind)
    union all select ns, ne
  ), o2 as (
    select iv.s, iv.e, max(iv.e) over (order by iv.s rows between unbounded preceding and 1 preceding) as pe from iv
  )
  select greatest(max(o2.s - coalesce(o2.pe, 0)), 10080 - max(o2.e) + min(o2.s)) into maxgap from o2;
  if maxgap < br.weekly_rest_hours * 60 then
    return format('אין %s שעות מנוחה רצופות בשבוע', br.weekly_rest_hours);
  end if;
  return null;
end $$;

-- Can this swap happen right now? Null = yes.
create or replace function public._swap_problem(sw public.shift_swaps)
returns text language plpgsql stable security definer set search_path = public as $$
declare sc public.schedules; req text; tgt text; p text; today date := (now() at time zone 'Asia/Jerusalem')::date;
begin
  select * into sc from public.schedules where id = sw.schedule_id;
  select full_name into req from public.members where id = sw.requester_id;
  select full_name into tgt from public.members where id = sw.target_id;
  if sc.status <> 'published' then return 'הסידור כבר לא מפורסם'; end if;
  if sc.week_start + sw.from_weekday < today or (sw.to_weekday is not null and sc.week_start + sw.to_weekday < today) then
    return 'המשמרת כבר עברה';
  end if;
  if not exists (select 1 from public.assignments where schedule_id = sw.schedule_id and member_id = sw.requester_id
                 and weekday = sw.from_weekday and kind = sw.from_kind) then
    return format('%s כבר לא משובץ/ת במשמרת הזו', req);
  end if;
  if exists (select 1 from public.assignments where schedule_id = sw.schedule_id and member_id = sw.target_id
             and weekday = sw.from_weekday and kind = sw.from_kind) then
    return format('%s כבר משובץ/ת במשמרת הזו', tgt);
  end if;

  if sw.to_weekday is null then
    p := public._shift_problem(sw.target_id, sw.schedule_id, sw.from_weekday, sw.from_kind);
    return case when p is null then null else tgt || ': ' || p end;
  end if;

  if not exists (select 1 from public.assignments where schedule_id = sw.schedule_id and member_id = sw.target_id
                 and weekday = sw.to_weekday and kind = sw.to_kind) then
    return format('%s כבר לא משובץ/ת במשמרת שהוצעה בתמורה', tgt);
  end if;
  if exists (select 1 from public.assignments where schedule_id = sw.schedule_id and member_id = sw.requester_id
             and weekday = sw.to_weekday and kind = sw.to_kind) then
    return format('%s כבר משובץ/ת במשמרת שהוצעה בתמורה', req);
  end if;
  p := public._shift_problem(sw.target_id, sw.schedule_id, sw.from_weekday, sw.from_kind, sw.to_weekday, sw.to_kind);
  if p is not null then return tgt || ': ' || p; end if;
  p := public._shift_problem(sw.requester_id, sw.schedule_id, sw.to_weekday, sw.to_kind, sw.from_weekday, sw.from_kind);
  if p is not null then return req || ': ' || p; end if;
  return null;
end $$;

create or replace function public._execute_swap(sw public.shift_swaps)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.assignments set member_id = sw.target_id, is_locked = true
  where schedule_id = sw.schedule_id and member_id = sw.requester_id
    and weekday = sw.from_weekday and kind = sw.from_kind;
  if sw.to_weekday is not null then
    update public.assignments set member_id = sw.requester_id, is_locked = true
    where schedule_id = sw.schedule_id and member_id = sw.target_id
      and weekday = sw.to_weekday and kind = sw.to_kind;
  end if;
end $$;

-- Owner and the managers of the member's branches (with an account), minus excluded people.
create or replace function public._managers_of(p_member uuid, p_exclude uuid[])
returns uuid[] language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct x.id), '{}')
  from public.members x join public.members t on t.id = p_member
  where x.org_id = t.org_id and x.is_active and x.user_id is not null
    and not (x.id = any (p_exclude))
    and (x.role = 'owner' or (x.role = 'manager' and exists (
          select 1 from public.branch_members a join public.branch_members b using (branch_id)
          where a.member_id = x.id and b.member_id = t.id)))
$$;

-- Creates in-app notifications and returns the push alerts to send.
create or replace function public._notify(p_members uuid[], p_kind text, p_title text, p_body text, p_url text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  insert into public.notifications (member_id, kind, title, body, url)
  select m.id, p_kind, p_title, p_body, p_url from public.members m
  where m.id in (select unnest(p_members)) and m.is_active and m.user_id is not null;

  select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth,
                                               'title', p_title, 'body', p_body, 'url', p_url)), '[]'::jsonb)
  into v
  from public.push_subscriptions s join public.members m on m.id = s.member_id
  where s.member_id in (select unnest(p_members)) and m.is_active and m.user_id is not null;
  return v;
end $$;

create or replace function public._me()
returns public.members language sql stable security definer set search_path = public as $$
  select * from public.members where user_id = auth.uid() and is_active limit 1
$$;

-- ---------------------------------------------------------------------------
-- Functions the app calls. Each returns {ok, message, push}.
-- ---------------------------------------------------------------------------

-- Who could take my shift, and which of their shifts I could take in exchange.
create or replace function public.swap_options(p_schedule uuid, p_weekday int, p_kind public.shift_kind)
returns table (member_id uuid, full_name text, can_take boolean, exchange jsonb)
language sql stable security definer set search_path = public as $$
  with me as (select * from public._me()),
  sc as (
    select s.* from public.schedules s, me
    where s.id = p_schedule and s.status = 'published'
      and exists (select 1 from public.assignments a where a.schedule_id = s.id and a.member_id = me.id
                  and a.weekday = p_weekday and a.kind = p_kind)
  )
  select c.id, c.full_name,
    public._shift_problem(c.id, sc.id, p_weekday, p_kind) is null
      and not exists (select 1 from public.assignments x where x.schedule_id = sc.id and x.member_id = c.id
                      and x.weekday = p_weekday and x.kind = p_kind),
    coalesce((
      select jsonb_agg(jsonb_build_object('weekday', a.weekday, 'kind', a.kind,
                                          'label', public._shift_label(sc.week_start, a.weekday, a.kind))
                       order by a.weekday, a.kind)
      from public.assignments a
      where a.schedule_id = sc.id and a.member_id = c.id
        and not (a.weekday = p_weekday and a.kind = p_kind)
        and sc.week_start + a.weekday >= (now() at time zone 'Asia/Jerusalem')::date
        and not exists (select 1 from public.assignments x where x.schedule_id = sc.id and x.member_id = me.id
                        and x.weekday = a.weekday and x.kind = a.kind)
        and not exists (select 1 from public.assignments x where x.schedule_id = sc.id and x.member_id = c.id
                        and x.weekday = p_weekday and x.kind = p_kind)
        and public._shift_problem(c.id, sc.id, p_weekday, p_kind, a.weekday, a.kind) is null
        and public._shift_problem(me.id, sc.id, a.weekday, a.kind, p_weekday, p_kind) is null
    ), '[]'::jsonb)
  from sc, me
  join public.branch_members bm on true
  join public.members c on c.id = bm.member_id
  where bm.branch_id = sc.branch_id and c.id <> me.id and c.is_active and c.user_id is not null
  order by c.full_name
$$;

create or replace function public.request_swap(p_schedule uuid, p_from_weekday int, p_from_kind public.shift_kind,
  p_target uuid, p_to_weekday int default null, p_to_kind public.shift_kind default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.members; tgt public.members; sc public.schedules; sw public.shift_swaps; p text; push jsonb;
begin
  me := public._me();
  if me.id is null then raise exception 'Not signed in' using errcode = '42501'; end if;
  select * into sc from public.schedules where id = p_schedule;
  if sc.id is null or not exists (select 1 from public.branch_members where branch_id = sc.branch_id and member_id = me.id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if sc.status <> 'published' then
    return jsonb_build_object('ok', false, 'message', 'אפשר לבקש החלפה רק בסידור שפורסם.');
  end if;
  select * into tgt from public.members where id = p_target;
  if tgt.id is null or tgt.id = me.id or tgt.org_id <> me.org_id then
    return jsonb_build_object('ok', false, 'message', 'בחרו עובד/ת אחר/ת מהסניף.');
  end if;
  if tgt.user_id is null then
    return jsonb_build_object('ok', false, 'message', format('ל%s אין עדיין חשבון באפליקציה.', tgt.full_name));
  end if;
  if exists (select 1 from public.shift_swaps where schedule_id = p_schedule and requester_id = me.id
             and from_weekday = p_from_weekday and from_kind = p_from_kind
             and status in ('pending_peer', 'pending_manager')) then
    return jsonb_build_object('ok', false, 'message', 'כבר יש בקשה פתוחה על המשמרת הזו.');
  end if;

  sw.schedule_id := p_schedule; sw.requester_id := me.id; sw.target_id := tgt.id;
  sw.from_weekday := p_from_weekday; sw.from_kind := p_from_kind;
  sw.to_weekday := p_to_weekday; sw.to_kind := p_to_kind;
  p := public._swap_problem(sw);
  if p is not null then return jsonb_build_object('ok', false, 'message', 'אי אפשר: ' || p); end if;

  insert into public.shift_swaps (schedule_id, requester_id, from_weekday, from_kind, target_id, to_weekday, to_kind, note)
  values (p_schedule, me.id, p_from_weekday, p_from_kind, tgt.id, p_to_weekday, p_to_kind, nullif(trim(p_note), ''))
  returning * into sw;

  push := public._notify(array[tgt.id], 'swap_requested',
    case when p_to_weekday is null then format('%s מציע/ה לך משמרת', me.full_name)
         else format('%s מבקש/ת להחליף איתך משמרת', me.full_name) end,
    public._shift_label(sc.week_start, p_from_weekday, p_from_kind)
      || case when p_to_weekday is null then '' else ' ⇄ ' || public._shift_label(sc.week_start, p_to_weekday, p_to_kind) end
      || coalesce(' · ' || sw.note, ''),
    '/schedule?week=' || sc.week_start);
  return jsonb_build_object('ok', true, 'message', format('הבקשה נשלחה ל%s.', tgt.full_name), 'push', push);
end $$;

create or replace function public.respond_swap(p_swap uuid, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.members; sw public.shift_swaps; sc public.schedules; req public.members; mode text;
        p text; push jsonb; label text; url text;
begin
  me := public._me();
  select * into sw from public.shift_swaps where id = p_swap for update;
  if me.id is null or sw.id is null or sw.target_id <> me.id then raise exception 'Not allowed' using errcode = '42501'; end if;
  if sw.status <> 'pending_peer' then return jsonb_build_object('ok', false, 'message', 'הבקשה כבר לא פתוחה.'); end if;
  select * into sc from public.schedules where id = sw.schedule_id;
  select * into req from public.members where id = sw.requester_id;
  label := public._shift_label(sc.week_start, sw.from_weekday, sw.from_kind)
    || case when sw.to_weekday is null then '' else ' ⇄ ' || public._shift_label(sc.week_start, sw.to_weekday, sw.to_kind) end;
  url := '/schedule?week=' || sc.week_start;

  if not p_accept then
    update public.shift_swaps set status = 'declined' where id = sw.id;
    push := public._notify(array[req.id], 'swap_declined', format('%s דחה/תה את בקשת ההחלפה', me.full_name), label, url);
    return jsonb_build_object('ok', true, 'message', 'הבקשה נדחתה.', 'push', push);
  end if;

  p := public._swap_problem(sw);
  if p is not null then
    update public.shift_swaps set status = 'failed', failure_reason = p where id = sw.id;
    push := public._notify(array[req.id], 'swap_failed', 'ההחלפה לא התאפשרה', p, url);
    return jsonb_build_object('ok', false, 'message', 'אי אפשר לבצע את ההחלפה: ' || p, 'push', push);
  end if;

  select swap_approval into mode from public.branches where id = sc.branch_id;
  if mode = 'auto' then
    perform public._execute_swap(sw);
    update public.shift_swaps set status = 'approved' where id = sw.id;
    push := public._notify(array[req.id], 'swap_done', format('ההחלפה עם %s בוצעה', me.full_name), label, url)
         || public._notify(public._managers_of(req.id, array[req.id, me.id]), 'swap_done',
              format('%s ו%s החליפו משמרות', req.full_name, me.full_name), label, url);
    return jsonb_build_object('ok', true, 'message', 'ההחלפה בוצעה, והסידור עודכן.', 'push', push);
  end if;

  update public.shift_swaps set status = 'pending_manager' where id = sw.id;
  push := public._notify(array[req.id], 'swap_accepted', format('%s הסכים/ה להחלפה', me.full_name),
            'ממתין לאישור המנהל · ' || label, url)
       || public._notify(public._managers_of(req.id, array[req.id, me.id]), 'swap_needs_approval',
            'בקשת החלפת משמרות ממתינה לאישורך', format('%s ⇄ %s · %s', req.full_name, me.full_name, label), url);
  return jsonb_build_object('ok', true, 'message', 'הסכמת. הבקשה עברה לאישור המנהל.', 'push', push);
end $$;

create or replace function public.decide_swap(p_swap uuid, p_approve boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.members; sw public.shift_swaps; sc public.schedules; p text; push jsonb; label text; url text;
begin
  me := public._me();
  select * into sw from public.shift_swaps where id = p_swap for update;
  if me.id is null or sw.id is null or not public.manages_member(sw.requester_id) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if sw.status <> 'pending_manager' then return jsonb_build_object('ok', false, 'message', 'הבקשה כבר לא ממתינה לאישור.'); end if;
  select * into sc from public.schedules where id = sw.schedule_id;
  label := public._shift_label(sc.week_start, sw.from_weekday, sw.from_kind)
    || case when sw.to_weekday is null then '' else ' ⇄ ' || public._shift_label(sc.week_start, sw.to_weekday, sw.to_kind) end;
  url := '/schedule?week=' || sc.week_start;

  if not p_approve then
    update public.shift_swaps set status = 'rejected', decided_by = me.id where id = sw.id;
    push := public._notify(array[sw.requester_id, sw.target_id], 'swap_rejected', 'המנהל לא אישר את ההחלפה', label, url);
    return jsonb_build_object('ok', true, 'message', 'ההחלפה נדחתה.', 'push', push);
  end if;

  p := public._swap_problem(sw);
  if p is not null then
    update public.shift_swaps set status = 'failed', failure_reason = p, decided_by = me.id where id = sw.id;
    push := public._notify(array[sw.requester_id, sw.target_id], 'swap_failed', 'ההחלפה לא התאפשרה', p, url);
    return jsonb_build_object('ok', false, 'message', 'אי אפשר לבצע את ההחלפה: ' || p, 'push', push);
  end if;
  perform public._execute_swap(sw);
  update public.shift_swaps set status = 'approved', decided_by = me.id where id = sw.id;
  push := public._notify(array[sw.requester_id, sw.target_id], 'swap_done', 'ההחלפה אושרה', label, url);
  return jsonb_build_object('ok', true, 'message', 'ההחלפה אושרה, והסידור עודכן.', 'push', push);
end $$;

create or replace function public.cancel_swap(p_swap uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare me public.members; sw public.shift_swaps; sc public.schedules; push jsonb;
begin
  me := public._me();
  select * into sw from public.shift_swaps where id = p_swap for update;
  if me.id is null or sw.id is null or sw.requester_id <> me.id then raise exception 'Not allowed' using errcode = '42501'; end if;
  if sw.status not in ('pending_peer', 'pending_manager') then
    return jsonb_build_object('ok', false, 'message', 'הבקשה כבר לא פתוחה.');
  end if;
  select * into sc from public.schedules where id = sw.schedule_id;
  update public.shift_swaps set status = 'cancelled' where id = sw.id;
  push := public._notify(array[sw.target_id], 'swap_cancelled', format('%s ביטל/ה את בקשת ההחלפה', me.full_name),
            public._shift_label(sc.week_start, sw.from_weekday, sw.from_kind), '/schedule?week=' || sc.week_start);
  return jsonb_build_object('ok', true, 'message', 'הבקשה בוטלה.', 'push', push);
end $$;

-- Permissions: internal helpers are never callable from the app.
revoke execute on function public._slot_bounds(uuid, int, public.shift_kind),
                           public._shift_label(date, int, public.shift_kind),
                           public._shift_problem(uuid, uuid, int, public.shift_kind, int, public.shift_kind),
                           public._swap_problem(public.shift_swaps),
                           public._execute_swap(public.shift_swaps),
                           public._managers_of(uuid, uuid[]),
                           public._notify(uuid[], text, text, text, text),
                           public._me()
  from public, anon, authenticated;
revoke execute on function public.swap_options(uuid, int, public.shift_kind),
                           public.request_swap(uuid, int, public.shift_kind, uuid, int, public.shift_kind, text),
                           public.respond_swap(uuid, boolean),
                           public.decide_swap(uuid, boolean),
                           public.cancel_swap(uuid)
  from public, anon;
grant execute on function public.swap_options(uuid, int, public.shift_kind),
                          public.request_swap(uuid, int, public.shift_kind, uuid, int, public.shift_kind, text),
                          public.respond_swap(uuid, boolean),
                          public.decide_swap(uuid, boolean),
                          public.cancel_swap(uuid)
  to authenticated;
