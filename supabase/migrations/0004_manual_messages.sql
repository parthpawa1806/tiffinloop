-- Chats: ops can message a subscriber outside any dropout event, so a message no longer
-- always belongs to an event or an order.
alter table notifications alter column event_id drop not null;
alter table notifications alter column deadline drop not null;
alter table notifications alter column order_ids set default '{}';
alter table notifications add column kind text not null default 'dropout'
  check (kind in ('dropout', 'manual'));
create index notifications_person_idx on notifications (canonical_subscriber_id, sent_at);
