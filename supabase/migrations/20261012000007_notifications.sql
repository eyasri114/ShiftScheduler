-- Notifications
--
-- notifications        what each person sees under the bell in the app
-- push_subscriptions   phones/browsers that agreed to receive push alerts
--
-- People create notifications for others only through two functions, which
-- check who may notify whom:
--   notify_members()          a manager → people they manage (schedule, leave decisions)
--   notify_branch_managers()  anyone → the managers of their own branch (new requests)
-- Both return the push subscriptions of the people notified, so the server
-- can send phone alerts without ever reading anyone else's subscriptions.
--
-- Safe to run more than once.

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members(id) on delete cascade,
  kind        text not null,
  title       text not null,
  body        text,
  url         text,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index if not exists notifications_member_idx on public.notifications (member_id, created_at desc);

create table if not exists public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.members(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index if not exists push_subscriptions_member_idx on public.push_subscriptions (member_id);

alter table public.notifications      enable row level security;
alter table public.push_subscriptions enable row level security;

-- Each person reads and marks their own notifications; nobody inserts directly.
drop policy if exists notif_select on public.notifications;
create policy notif_select on public.notifications for select to authenticated using (public.is_self(member_id));
drop policy if exists notif_update on public.notifications;
create policy notif_update on public.notifications for update to authenticated
  using (public.is_self(member_id)) with check (public.is_self(member_id));
drop policy if exists notif_delete on public.notifications;
create policy notif_delete on public.notifications for delete to authenticated using (public.is_self(member_id));

-- Each person manages only their own devices.
drop policy if exists push_self on public.push_subscriptions;
create policy push_self on public.push_subscriptions for all to authenticated
  using (public.is_self(member_id)) with check (public.is_self(member_id));

grant select, update, delete on public.notifications to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

create or replace function public.notify_members(
  p_members uuid[], p_kind text, p_title text, p_body text, p_url text)
returns table (member_id uuid, endpoint text, p256dh text, auth text)
language plpgsql security definer set search_path = public as $$
begin
  return query
  with targets as (
    select m.id from public.members m
    where m.id = any(p_members) and m.is_active and m.user_id is not null
      and public.manages_member(m.id)
  ), ins as (
    insert into public.notifications (member_id, kind, title, body, url)
    select t.id, p_kind, p_title, p_body, p_url from targets t
    returning notifications.member_id
  )
  select s.member_id, s.endpoint, s.p256dh, s.auth
  from public.push_subscriptions s where s.member_id in (select i.member_id from ins i);
end $$;

create or replace function public.notify_branch_managers(
  p_kind text, p_title text, p_body text, p_url text)
returns table (member_id uuid, endpoint text, p256dh text, auth text)
language plpgsql security definer set search_path = public as $$
declare me public.members;
begin
  select * into me from public.members where user_id = auth.uid() and is_active;
  if me.id is null then return; end if;
  return query
  with targets as (
    select m.id from public.members m
    where m.org_id = me.org_id and m.is_active and m.user_id is not null and m.id <> me.id
      and (m.role = 'owner'
           or (m.role = 'manager' and exists (
                 select 1 from public.branch_members a join public.branch_members b using (branch_id)
                 where a.member_id = m.id and b.member_id = me.id)))
  ), ins as (
    insert into public.notifications (member_id, kind, title, body, url)
    select t.id, p_kind, p_title, p_body, p_url from targets t
    returning notifications.member_id
  )
  select s.member_id, s.endpoint, s.p256dh, s.auth
  from public.push_subscriptions s where s.member_id in (select i.member_id from ins i);
end $$;

-- Phones that unsubscribed or reinstalled: the push service answers "gone".
create or replace function public.remove_dead_subscriptions(p_endpoints text[])
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  delete from public.push_subscriptions s
  where s.endpoint = any(p_endpoints)
    and (public.is_self(s.member_id) or public.manages_member(s.member_id)
         or exists (select 1 from public.members me where me.user_id = auth.uid()));
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.notify_members(uuid[], text, text, text, text),
                           public.notify_branch_managers(text, text, text, text),
                           public.remove_dead_subscriptions(text[]) from public, anon;
grant  execute on function public.notify_members(uuid[], text, text, text, text),
                           public.notify_branch_managers(text, text, text, text),
                           public.remove_dead_subscriptions(text[]) to authenticated;
