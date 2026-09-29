-- `restart identity` requires owning the sequences, which service_role does not.
-- Serial IDs carry no meaning here, so drop it rather than make the function security definer.
create or replace function reset_all()
returns void
language sql
set search_path = public
as $$
  truncate event_log, notifications, order_resolutions, dropout_events,
           data_issues, whatsapp_messages, orders, subscribers, cooks;
$$;
