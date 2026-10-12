-- Demo data: same branch and 12 employees as the prototype.
-- Members have no login (user_id null) until they are invited.

insert into public.organizations (id, name)
values ('00000000-0000-0000-0000-0000000000a1', 'Demo Coffee');

insert into public.branches (id, org_id, name, shift_model, closed_weekdays)
values ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1',
        'סניף מרכז', 2, '{6}');

-- Weekly template
insert into public.template_slots (branch_id, weekday, kind, start_time, end_time, required)
select '00000000-0000-0000-0000-0000000000b1', d, k.kind, k.s, k.e,
  case
    when d = 4 and k.kind = 'evening' then 4          -- Thursday evening: reinforced
    when d = 5 and k.kind = 'morning' then 5          -- Friday morning: weekend rush
    when d = 5 then 0                                  -- Friday afternoon/night: closed
    when d = 6 and k.kind <> 'night' then 2
    else k.req
  end
from generate_series(0, 6) d
cross join (values ('morning'::public.shift_kind, '07:00'::time, '15:00'::time, 3),
                   ('evening',                    '15:00',       '23:00',       3),
                   ('night',                      '23:00',       '07:00',       1)) k(kind, s, e, req);

update public.template_slots set end_time = '14:00'
where branch_id = '00000000-0000-0000-0000-0000000000b1' and weekday = 5 and kind = 'morning';

-- Employees
insert into public.members (id, org_id, full_name, min_shifts, max_shifts, is_shift_lead, birth_date, allowed_kinds, rest_weekday)
values
  ('00000000-0000-0000-0000-000000000101', '00000000-0000-0000-0000-0000000000a1', 'דנה כהן',        3, 5, true,  '1995-03-14', '{morning,evening,night}', null),
  ('00000000-0000-0000-0000-000000000102', '00000000-0000-0000-0000-0000000000a1', 'אבי לוי',        3, 5, true,  '1990-07-02', '{morning,evening,night}', null),
  ('00000000-0000-0000-0000-000000000103', '00000000-0000-0000-0000-0000000000a1', 'מאיה פרץ',       2, 4, false, '1999-11-20', '{morning,evening,night}', null),
  ('00000000-0000-0000-0000-000000000104', '00000000-0000-0000-0000-0000000000a1', 'יוסי מזרחי',     3, 5, false, '1993-01-09', '{morning,evening,night}', null),
  ('00000000-0000-0000-0000-000000000105', '00000000-0000-0000-0000-0000000000a1', 'נועה אברהם',     2, 3, false, '2010-05-30', '{morning}',               null),
  ('00000000-0000-0000-0000-000000000106', '00000000-0000-0000-0000-0000000000a1', 'עומר ביטון',     2, 4, false, '2000-08-17', '{morning,evening,night}', null),
  ('00000000-0000-0000-0000-000000000107', '00000000-0000-0000-0000-0000000000a1', 'שירה דהן',       3, 5, false, '1997-02-25', '{morning,evening,night}', null),
  ('00000000-0000-0000-0000-000000000108', '00000000-0000-0000-0000-0000000000a1', 'איתי פרידמן',    3, 5, true,  '1992-12-03', '{morning,evening,night}', null),
  ('00000000-0000-0000-0000-000000000109', '00000000-0000-0000-0000-0000000000a1', 'רוני גבאי',      2, 4, false, '1998-06-11', '{morning,evening,night}', null),
  ('00000000-0000-0000-0000-000000000110', '00000000-0000-0000-0000-0000000000a1', 'תמר שלום',       2, 3, false, '2001-09-08', '{morning,evening,night}', null),
  ('00000000-0000-0000-0000-000000000111', '00000000-0000-0000-0000-0000000000a1', 'אחמד חאג׳',      3, 5, false, '1994-04-21', '{morning,evening,night}', 5),
  ('00000000-0000-0000-0000-000000000112', '00000000-0000-0000-0000-0000000000a1', 'אולגה סמירנוב',  2, 4, false, '1991-10-15', '{morning,evening,night}', 0);

insert into public.branch_members (branch_id, member_id)
select '00000000-0000-0000-0000-0000000000b1', id from public.members
where org_id = '00000000-0000-0000-0000-0000000000a1';

-- Next week's draft schedule and a few submitted constraints
insert into public.schedules (id, branch_id, week_start, closed_weekdays)
values ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000b1',
        current_date + (7 - extract(dow from current_date)::int), '{6}');

insert into public.availability (member_id, week_start, weekday, kind, level)
select m::uuid, current_date + (7 - extract(dow from current_date)::int), d, k::public.shift_kind, l::public.availability_level
from (values
  ('00000000-0000-0000-0000-000000000101', 0, 'evening', 'cannot'),
  ('00000000-0000-0000-0000-000000000101', 5, 'morning', 'prefer'),
  ('00000000-0000-0000-0000-000000000102', 1, 'morning', 'cannot'),
  ('00000000-0000-0000-0000-000000000102', 2, 'morning', 'cannot'),
  ('00000000-0000-0000-0000-000000000103', 0, 'morning', 'prefer'),
  ('00000000-0000-0000-0000-000000000103', 3, 'evening', 'cannot'),
  ('00000000-0000-0000-0000-000000000105', 1, 'morning', 'prefer'),
  ('00000000-0000-0000-0000-000000000106', 2, 'evening', 'prefer'),
  ('00000000-0000-0000-0000-000000000108', 2, 'evening', 'cannot'),
  ('00000000-0000-0000-0000-000000000109', 0, 'evening', 'prefer'),
  ('00000000-0000-0000-0000-000000000110', 5, 'morning', 'prefer')
) v(m, d, k, l);

insert into public.absences (member_id, type, start_date, end_date, note, status)
values ('00000000-0000-0000-0000-000000000110', 'vacation',
        current_date + (7 - extract(dow from current_date)::int) + 3,
        current_date + (7 - extract(dow from current_date)::int) + 4,
        'חתונה של אחותי', 'pending');
