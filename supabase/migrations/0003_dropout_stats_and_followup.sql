-- Per canonical cook: orders and dropouts in [p_from, p_to). Feeds backup reliability ranking
-- and the leadership dashboard. Done in SQL because the API caps responses at 1000 rows.
create function cook_dropout_stats(p_from date, p_to date)
returns table (cook_id text, total_orders int, dropout_orders int, dropout_days int)
language sql stable
set search_path = public
as $$
  with t as (
    select c.canonical_cook_id as cid, count(*)::int as n
    from orders o join cooks c on c.cook_id = o.cook_id
    where o.order_date >= p_from and o.order_date < p_to
    group by 1
  ),
  d as (
    select cook_id as cid, count(*)::int as n, count(distinct event_date)::int as days
    from dropout_orders
    where event_date >= p_from and event_date < p_to
    group by 1
  )
  select c.cook_id, coalesce(t.n, 0), coalesce(d.n, 0), coalesce(d.days, 0)
  from cooks c
  left join t on t.cid = c.cook_id
  left join d on d.cid = c.cook_id
  where c.cook_id = c.canonical_cook_id
$$;

revoke execute on function cook_dropout_stats(date, date) from public, anon, authenticated;
grant  execute on function cook_dropout_stats(date, date) to service_role;

-- A subscriber with no phone can't get a message. Ops follows up another way (delivery
-- partner note, email, collecting the number) and records it, so "was everyone notified?"
-- can reach yes.
alter table notifications drop constraint notifications_status_check;
alter table notifications add constraint notifications_status_check
  check (status in ('sent', 'failed_no_phone', 'followed_up'));
alter table notifications add column follow_up_note text;
