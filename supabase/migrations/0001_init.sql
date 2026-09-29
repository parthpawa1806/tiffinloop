-- TiffinLoop dropout tool: initial schema
--
-- Two kinds of tables:
--   1. Seeded reference data (cooks, subscribers, orders, whatsapp_messages, data_issues).
--      Loaded by scripts/seed.ts from the untouched CSVs in data/raw. Never mutated by the app.
--   2. Ops state (dropout_events, order_resolutions, notifications, event_log).
--      Written by the ops tool. Wiped by reset_demo() so every reviewer starts from the same state.
--
-- All access goes through the Next.js server using the service role key. RLS is enabled on
-- every table with no policies, so the public (anon) key can read or write nothing.

-- ── Enums ────────────────────────────────────────────────────────────────────
create type city_code     as enum ('BLR', 'MUM', 'PUNE');
create type meal_type     as enum ('lunch', 'dinner');
create type meal_plan     as enum ('lunch', 'dinner', 'both');
create type diet_type     as enum ('veg', 'non_veg', 'jain');
create type cuisine_type  as enum ('North Indian', 'South Indian', 'Bengali', 'Gujarati',
                                   'Punjabi', 'Maharashtrian', 'Continental');
create type order_status  as enum ('delivered', 'pending', 'in_progress', 'cancelled',
                                   'refunded', 'cook_dropout', 'unknown');

-- ── Seeded reference data ───────────────────────────────────────────────────
create table cooks (
  cook_id           text primary key,                        -- original CK###, never rewritten
  canonical_cook_id text not null references cooks (cook_id),-- = cook_id unless a duplicate
  name              text not null,
  city              city_code not null,
  cuisine_specialty cuisine_type not null,
  serves_veg        boolean not null,
  serves_non_veg    boolean not null,
  serves_jain       boolean not null,
  phone             char(10),                                -- null = missing (see data_issues)
  sheet_status      text not null check (sheet_status in ('active', 'on_leave', 'inactive')),
  status_since      date,                                    -- what the sheet claims; not the truth
  joined_date       date,
  max_daily_orders  int not null,
  raw               jsonb not null
);

create table subscribers (
  subscriber_id           text primary key,
  canonical_subscriber_id text not null references subscribers (subscriber_id),
  name                    text not null,
  city                    city_code not null,
  phone                   char(10),
  assigned_cook_id        text references cooks (cook_id),
  meal_plan               meal_plan not null,
  cuisine_pref            cuisine_type not null,
  diet                    diet_type not null,
  subscription_status     text not null check (subscription_status in ('active', 'paused')),
  start_date              date,
  raw                     jsonb not null
);

create table orders (
  order_id      text primary key,
  order_date    date not null,
  meal          meal_type not null,
  subscriber_id text not null references subscribers (subscriber_id),
  cook_id       text not null references cooks (cook_id),
  status        order_status not null,
  raw_status    text not null,
  amount_inr    int not null
);
create index orders_date_cook_idx on orders (order_date, cook_id);
create index orders_status_idx on orders (status);

create table whatsapp_messages (
  id             int primary key,          -- line number in the export
  sent_at        timestamptz not null,
  sender         text not null,
  sender_is_ops  boolean not null,
  sender_cook_id text references cooks (cook_id),
  body           text not null
);

-- What the seed script cleaned and why. Surfaced in the UI.
create table data_issues (
  id             serial primary key,
  entity         text not null,            -- cooks | subscribers | orders | whatsapp
  entity_id      text,                     -- null for aggregate issues (e.g. a status variant)
  issue          text not null,            -- missing_phone | duplicate_of | nonstandard_date | status_mapped | city_mapped | ...
  raw_value      text,
  resolved_value text,
  row_count      int not null default 1,
  detail         text
);

-- ── Ops state (reset by reset_demo) ─────────────────────────────────────────
create table dropout_events (
  id          uuid primary key default gen_random_uuid(),
  cook_id     text not null references cooks (cook_id),
  event_date  date not null,
  meals       meal_type[] not null,
  reason      text,
  source      text not null check (source in ('whatsapp', 'call', 'sheet', 'ops')),
  source_message_id int references whatsapp_messages (id),
  reported_at timestamptz not null,
  status      text not null default 'open' check (status in ('open', 'resolved')),
  created_at  timestamptz not null default now(),
  unique (cook_id, event_date)
);

create table order_resolutions (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null references dropout_events (id) on delete cascade,
  order_id       text not null unique references orders (order_id),  -- one decision per order
  action         text not null check (action in ('reassign', 'refund', 'unresolved')),
  backup_cook_id text references cooks (cook_id),
  refund_amount  int,
  was_suggested  boolean not null default false,  -- accepted system suggestion vs manual override
  reason         text,
  decided_at     timestamptz not null default now(),
  check ((action = 'reassign') = (backup_cook_id is not null)),
  check ((action = 'refund') = (refund_amount is not null))
);

create table notifications (
  id                      uuid primary key default gen_random_uuid(),
  event_id                uuid not null references dropout_events (id) on delete cascade,
  canonical_subscriber_id text not null references subscribers (subscriber_id),
  order_ids               text[] not null,  -- one message per person, even with duplicate accounts
  phone                   char(10),
  body                    text not null,
  status                  text not null check (status in ('sent', 'failed_no_phone', 'suppressed_duplicate')),
  deadline                timestamptz not null,  -- meal delivery start: must be sent before this
  sent_at                 timestamptz
);

create table event_log (                    -- append-only timeline per dropout event
  id       bigserial primary key,
  event_id uuid not null references dropout_events (id) on delete cascade,
  at       timestamptz not null default now(),
  actor    text not null,
  action   text not null,
  detail   jsonb not null default '{}'
);
create index event_log_event_idx on event_log (event_id, at);

-- ── Views ───────────────────────────────────────────────────────────────────
-- Each order with the cook now responsible for it after any ops decision.
create view orders_effective with (security_invoker = true) as
select
  o.*,
  coalesce(r.backup_cook_id, o.cook_id) as effective_cook_id,
  case when r.action = 'refund' then 'refunded'::order_status else o.status end as effective_status,
  r.action   as resolution_action,
  r.event_id as resolution_event_id
from orders o
left join order_resolutions r on r.order_id = o.order_id;

-- Every order lost to a cook dropout: historical (order log) + events logged in the ops tool.
-- Grouped by canonical cook so duplicate cook records count as one person.
create view dropout_orders with (security_invoker = true) as
select o.order_date as event_date, c.canonical_cook_id as cook_id, o.meal, o.order_id,
       'order_log'::text as source
from orders o
join cooks c on c.cook_id = o.cook_id
where o.status = 'cook_dropout'
union all
select e.event_date, c.canonical_cook_id, o.meal, o.order_id, 'ops_tool'
from dropout_events e
join cooks c  on c.cook_id = e.cook_id
join cooks oc on oc.canonical_cook_id = c.canonical_cook_id
join orders o on o.cook_id = oc.cook_id
             and o.order_date = e.event_date
             and o.meal = any (e.meals)
             and o.status in ('pending', 'in_progress');

-- ── Functions ───────────────────────────────────────────────────────────────
-- Capacity per canonical cook on a date. Load counts orders reassigned TO the cook, so a
-- backup's free slots shrink as ops assigns orders across multiple dropout events.
create function cook_capacity(p_date date)
returns table (
  cook_id text, name text, city city_code, cuisine_specialty cuisine_type,
  serves_veg boolean, serves_non_veg boolean, serves_jain boolean, phone char(10),
  sheet_status text, max_daily_orders int, load int, free_slots int,
  has_dropout_event boolean, is_available boolean
)
language sql stable
set search_path = public
as $$
  with load as (
    select c.canonical_cook_id as cid, count(*)::int as n
    from orders_effective oe
    join cooks c on c.cook_id = oe.effective_cook_id
    where oe.order_date = p_date
      and oe.effective_status in ('pending', 'in_progress', 'delivered')
    group by 1
  ),
  dropped as (
    select distinct c.canonical_cook_id as cid
    from dropout_events e
    join cooks c on c.cook_id = e.cook_id
    where e.event_date = p_date
  )
  select c.cook_id, c.name, c.city, c.cuisine_specialty,
         c.serves_veg, c.serves_non_veg, c.serves_jain, c.phone,
         c.sheet_status, c.max_daily_orders,
         coalesce(l.n, 0),
         c.max_daily_orders - coalesce(l.n, 0),
         d.cid is not null,
         c.sheet_status = 'active' and d.cid is null
  from cooks c
  left join load l    on l.cid = c.cook_id
  left join dropped d on d.cid = c.cook_id
  where c.cook_id = c.canonical_cook_id
$$;

-- Cooks the sheet already marks unavailable who still hold open orders on a date and have
-- no dropout event yet: dropouts ops has not acted on.
create function unhandled_sheet_dropouts(p_date date)
returns table (cook_id text, name text, sheet_status text, status_since date, open_orders int)
language sql stable
set search_path = public
as $$
  select c.canonical_cook_id, max(c.name), max(c.sheet_status), max(c.status_since), count(*)::int
  from orders o
  join cooks c on c.cook_id = o.cook_id
  where o.order_date = p_date
    and o.status in ('pending', 'in_progress')
    and c.sheet_status <> 'active'
    and not exists (
      select 1 from dropout_events e
      join cooks ec on ec.cook_id = e.cook_id
      where ec.canonical_cook_id = c.canonical_cook_id and e.event_date = p_date
    )
  group by c.canonical_cook_id
$$;

-- Wipe ops state only. Seeded data is untouched.
create function reset_demo()
returns void
language sql
set search_path = public
as $$
  truncate event_log, notifications, order_resolutions, dropout_events;
$$;

-- Wipe everything. Used by the seed script before reloading.
create function reset_all()
returns void
language sql
set search_path = public
as $$
  truncate event_log, notifications, order_resolutions, dropout_events,
           data_issues, whatsapp_messages, orders, subscribers, cooks restart identity;
$$;

-- ── Lock down ───────────────────────────────────────────────────────────────
alter table cooks             enable row level security;
alter table subscribers       enable row level security;
alter table orders            enable row level security;
alter table whatsapp_messages enable row level security;
alter table data_issues       enable row level security;
alter table dropout_events    enable row level security;
alter table order_resolutions enable row level security;
alter table notifications     enable row level security;
alter table event_log         enable row level security;

-- TRUNCATE ignores RLS, so functions must not be callable with the public key.
revoke execute on function cook_capacity(date)            from public, anon, authenticated;
revoke execute on function unhandled_sheet_dropouts(date) from public, anon, authenticated;
revoke execute on function reset_demo()                   from public, anon, authenticated;
revoke execute on function reset_all()                    from public, anon, authenticated;
grant  execute on function cook_capacity(date)            to service_role;
grant  execute on function unhandled_sheet_dropouts(date) to service_role;
grant  execute on function reset_demo()                   to service_role;
grant  execute on function reset_all()                    to service_role;
