-- Smart-Job ERP database profiling checklist.
-- Run against a local or staging database with representative row counts before
-- adding or removing broad indexes. Replace the :variables with real values.

create extension if not exists pg_stat_statements;
create extension if not exists index_advisor;

-- Current slow/outlier queries. Requires pg_stat_statements.
select
  calls,
  round(total_exec_time::numeric, 2) as total_exec_ms,
  round(mean_exec_time::numeric, 2) as mean_exec_ms,
  rows,
  left(query, 240) as query_sample
from pg_stat_statements
where query ilike '%clients%'
   or query ilike '%jobs%'
   or query ilike '%documents%'
   or query ilike '%inventory_%'
   or query ilike '%tax_invoice_reservations%'
   or query ilike '%tax_oauth_callbacks%'
   or query ilike '%support_conversations%'
order by total_exec_time desc
limit 40;

-- Index hit ratios and table sizes.
select
  relname,
  n_live_tup,
  seq_scan,
  idx_scan,
  round(100 * idx_scan::numeric / nullif(seq_scan + idx_scan, 0), 2) as pct_index_used
from pg_stat_user_tables
where relname in (
  'clients',
  'jobs',
  'documents',
  'inventory_parts',
  'inventory_balances',
  'tax_invoice_reservations',
  'tax_oauth_callbacks',
  'support_conversations'
)
order by n_live_tup desc;

-- Unused or cold indexes. Review with production-like traffic before dropping.
select
  schemaname,
  relname,
  indexrelname,
  idx_scan,
  pg_size_pretty(pg_relation_size(indexrelid)) as index_size
from pg_stat_user_indexes
where relname in (
  'clients',
  'jobs',
  'documents',
  'inventory_parts',
  'inventory_balances',
  'tax_invoice_reservations',
  'tax_oauth_callbacks',
  'support_conversations'
)
order by idx_scan asc, pg_relation_size(indexrelid) desc;

-- Representative EXPLAIN targets.
explain (analyze, buffers)
select *
from get_clients_page(:company_id::uuid, 50, null, null, :client_search::text);

explain (analyze, buffers)
select *
from get_company_inventory_page(:company_id::uuid, 50, null, null, :inventory_search::text);

explain (analyze, buffers)
select *
from get_member_inventory_page(:company_id::uuid, :target_uid::text, 50, null, null, :inventory_search::text);

explain (analyze, buffers)
select document_id, document_number, status_payload
from tax_invoice_reservations
where company_id = :company_id::uuid
  and status = 'reserved'
  and status_payload @> jsonb_build_object('idempotencyKey', :idempotency_key::text)
order by created_at desc
limit 1;

explain (analyze, buffers)
select id, used, token_exchange_success, token_exchange_error, token_exchange_attempted_at
from tax_oauth_callbacks
where oauth_session_id = :oauth_session_id::uuid
order by created_at desc
limit 1;

explain (analyze, buffers)
select id, user_id, category, status, last_message_text, last_message_at
from support_conversations
order by last_message_at desc
limit 200;

-- Optional advisor examples. Treat output as a starting point, not an automatic migration.
select *
from index_advisor(
  'select * from get_clients_page(''' || :company_id::text || '''::uuid, 50, null, null, ''' || :client_search::text || ''')'
);
