\set ON_ERROR_STOP on

SELECT count(*) = 4 AS required_roles_exist
FROM pg_catalog.pg_roles
WHERE rolname IN ('smart_job_api', 'smart_job_pdf', 'smart_job_email', 'smart_job_archiver')
\gset

\if :required_roles_exist
\else
  \echo 'Required runtime roles are missing. Apply all Drizzle migrations first.'
  \quit 1
\endif

SELECT pg_catalog.format('ALTER ROLE %I LOGIN PASSWORD %L', role_name, role_password)
FROM (VALUES
  ('smart_job_api', :'api_password'),
  ('smart_job_pdf', :'pdf_password'),
  ('smart_job_email', :'email_password'),
  ('smart_job_archiver', :'archiver_password')
) AS credentials(role_name, role_password)
\gexec

SELECT bool_and(
  rolcanlogin
  AND NOT rolsuper
  AND NOT rolcreatedb
  AND NOT rolcreaterole
  AND NOT rolreplication
  AND NOT rolbypassrls
) AS runtime_roles_are_limited
FROM pg_catalog.pg_roles
WHERE rolname IN ('smart_job_api', 'smart_job_pdf', 'smart_job_email', 'smart_job_archiver')
\gset

\if :runtime_roles_are_limited
  \echo 'Local runtime role passwords and safety attributes verified.'
\else
  \echo 'A local runtime role has unsafe attributes.'
  \quit 1
\endif
