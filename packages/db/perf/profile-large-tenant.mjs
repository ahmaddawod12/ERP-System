#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import pg from 'pg';

const { Client } = pg;
const databaseUrl = String(process.env.DATABASE_URL || '').trim();
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const parsed = new URL(databaseUrl);
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsed.hostname.toLowerCase())) {
  throw new Error('The synthetic profile is fixture-heavy and may run only on a loopback database');
}

const RUNS = 20;
const LIST_TARGET_MS = 300;
const SEARCH_TARGET_MS = 500;
const companyId = randomUUID();
const userId = randomUUID();
const membershipId = randomUUID();
const locationId = randomUUID();
const suffix = companyId.slice(0, 8);
const client = new Client({
  connectionString: databaseUrl,
  application_name: 'smart-job-batch5-large-tenant-profile',
  ssl: false,
});

function percentile(values, value) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * value) - 1)];
}

async function measure(name, text, values) {
  await client.query(text, values);
  const samples = [];
  for (let index = 0; index < RUNS; index += 1) {
    const started = performance.now();
    await client.query(text, values);
    samples.push(performance.now() - started);
  }
  return {
    name,
    p50Ms: Number(percentile(samples, 0.5).toFixed(2)),
    p95Ms: Number(percentile(samples, 0.95).toFixed(2)),
    maxMs: Number(Math.max(...samples).toFixed(2)),
  };
}

const jobsList = `
  SELECT job.id
  FROM public.jobs AS job
  WHERE job.company_id = $1::uuid
  ORDER BY job.created_at DESC, job.id DESC
  LIMIT 51
`;
const jobsSearch = `
  SELECT job.id
  FROM public.jobs AS job
  WHERE job.company_id = $1::uuid
    AND job.search_text LIKE '%' || $2::text || '%'
  ORDER BY job.created_at DESC, job.id DESC
  LIMIT 51
`;
const documentsList = `
  SELECT document.id
  FROM public.documents AS document
  WHERE document.company_id = $1::uuid
  ORDER BY document.created_at DESC, document.id DESC
  LIMIT 51
`;
const documentsSearch = `
  SELECT document.id
  FROM public.documents AS document
  WHERE document.company_id = $1::uuid
    AND (
      document.search_text LIKE '%' || $2::text || '%'
      OR document.document_number::text LIKE $3::text
    )
  ORDER BY document.created_at DESC, document.id DESC
  LIMIT 51
`;
const inventorySearch = `
  SELECT part.id
  FROM public.inventory_parts AS part
  WHERE part.company_id = $1::uuid
    AND part.archived_at IS NULL
    AND (
      part.normalized_name LIKE '%' || $2::text || '%'
      OR part.part_no::text LIKE $3::text
    )
  ORDER BY part.part_no ASC, part.id ASC
  LIMIT 51
`;

await client.connect();
let transactionOpen = false;
try {
  await client.query('BEGIN');
  transactionOpen = true;
  await client.query("SET LOCAL synchronous_commit = 'off'");
  await client.query("SET LOCAL statement_timeout = '10min'");
  await client.query(
    `INSERT INTO public.app_users (id, email, display_name)
     VALUES ($1, $2, 'Batch 5 profiler')`,
    [userId, `batch5-${suffix}@example.invalid`],
  );
  await client.query(
    `INSERT INTO public.companies (id, public_company_id, account_type, status, created_by_user_id)
     VALUES ($1, $2, 'business', 'active', $3)`,
    [companyId, 8_900_000_000_000 + Number.parseInt(suffix, 16), userId],
  );
  await client.query('INSERT INTO public.company_sync_state (company_id) VALUES ($1)', [companyId]);
  await client.query(
    `INSERT INTO public.company_subscriptions (company_id, tier, status, enabled_modules)
     VALUES ($1, 'Team', 'active', '{"jobs":true,"inventory":true,"documents":true}'::jsonb)`,
    [companyId],
  );
  await client.query(
    `INSERT INTO public.company_memberships (
       id, company_id, user_id, member_no, role, status, display_name
     ) VALUES ($1, $2, $3, 1, 'manager', 'active', 'Batch 5 profiler')`,
    [membershipId, companyId, userId],
  );
  await client.query(
    `INSERT INTO public.inventory_locations (id, company_id, location_type, name)
     VALUES ($1, $2, 'company', 'Main')`,
    [locationId, companyId],
  );

  await client.query(
    `INSERT INTO public.jobs (
       id, company_id, job_no, status, title, description, location, address,
       assigned_membership_id, created_by_membership_id,
       client_name_snapshot, client_phone_snapshot,
       assigned_member_name_snapshot, created_by_name_snapshot,
       created_at, updated_at, finished_at
     )
     SELECT
       pg_catalog.md5($2::text || ':job:' || value)::uuid,
       $1::uuid,
       value,
       CASE WHEN value % 4 = 0 THEN 'finished' ELSE 'pending' END::public.job_status,
       CASE WHEN value % 10000 = 0 THEN 'Batch5Needle service ' || value ELSE 'Service job ' || value END,
       'Synthetic maintenance work order ' || value,
       'District ' || (value % 100),
       'Street ' || value,
       $3::uuid,
       $3::uuid,
       'Client ' || (value % 5000),
       '050' || pg_catalog.lpad((value % 10000000)::text, 7, '0'),
       'Profiler',
       'Profiler',
       '2025-01-01T00:00:00Z'::timestamptz + value * interval '1 second',
       '2025-01-01T00:00:00Z'::timestamptz + value * interval '1 second',
       CASE WHEN value % 4 = 0
         THEN '2025-01-01T00:00:00Z'::timestamptz + value * interval '1 second'
         ELSE NULL
       END
     FROM pg_catalog.generate_series(1, 100000) AS series(value)`,
    [companyId, suffix, membershipId],
  );
  await client.query(
    `INSERT INTO public.documents (
       id, company_id, document_type, document_number, document_code,
       generation_status, tax_authority_status, created_by_membership_id,
       client_name_snapshot, created_at, updated_at
     )
     SELECT
       pg_catalog.md5($2::text || ':document:' || value)::uuid,
       $1::uuid,
       200,
       value,
       CASE WHEN value % 10000 = 0 THEN 'BATCH5NEEDLE-' || value ELSE 'DOC-' || value END,
       'completed'::public.document_generation_status,
       'none'::public.tax_authority_status,
       $3::uuid,
       'Client ' || (value % 5000),
       '2025-01-01T00:00:00Z'::timestamptz + value * interval '1 second',
       '2025-01-01T00:00:00Z'::timestamptz + value * interval '1 second'
     FROM pg_catalog.generate_series(1, 50000) AS series(value)`,
    [companyId, suffix, membershipId],
  );
  await client.query(
    `INSERT INTO public.inventory_parts (
       id, company_id, part_no, name, created_at, updated_at
     )
     SELECT
       pg_catalog.md5($2::text || ':part:' || value)::uuid,
       $1::uuid,
       value,
       CASE WHEN value % 5000 = 0 THEN 'Batch5Needle part ' || value ELSE 'Replacement part ' || value END,
       clock_timestamp(), clock_timestamp()
     FROM pg_catalog.generate_series(1, 20000) AS series(value)`,
    [companyId, suffix],
  );
  await client.query('ANALYZE public.jobs');
  await client.query('ANALYZE public.documents');
  await client.query('ANALYZE public.inventory_parts');

  const results = [];
  results.push(await measure('jobs_list', jobsList, [companyId]));
  results.push(await measure('jobs_search', jobsSearch, [companyId, 'batch5needle']));
  results.push(await measure('documents_list', documentsList, [companyId]));
  results.push(await measure('documents_search', documentsSearch, [companyId, 'batch5needle', 'batch5needle%']));
  results.push(await measure('inventory_search', inventorySearch, [companyId, 'batch5needle', 'batch5needle%']));

  const report = {
    fixture: { jobs: 100000, documents: 50000, inventoryParts: 20000, runsPerQuery: RUNS },
    targetsMs: { listP95: LIST_TARGET_MS, searchP95: SEARCH_TARGET_MS },
    results: results.map((result) => ({
      ...result,
      targetMs: result.name.endsWith('_list') ? LIST_TARGET_MS : SEARCH_TARGET_MS,
      passed: result.p95Ms < (result.name.endsWith('_list') ? LIST_TARGET_MS : SEARCH_TARGET_MS),
    })),
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  if (transactionOpen) await client.query('ROLLBACK').catch(() => undefined);
  await client.query('ANALYZE public.jobs').catch(() => undefined);
  await client.query('ANALYZE public.documents').catch(() => undefined);
  await client.query('ANALYZE public.inventory_parts').catch(() => undefined);
  await client.end();
}
