BEGIN;

CREATE SCHEMA IF NOT EXISTS control;
CREATE SCHEMA IF NOT EXISTS private;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'smart_job_control_api') THEN
    CREATE ROLE smart_job_control_api
      NOLOGIN
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOINHERIT
      NOREPLICATION
      NOBYPASSRLS;
  END IF;
END
$$;

CREATE TABLE control.schema_metadata (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  schema_version text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO control.schema_metadata (singleton, schema_version)
VALUES (true, 'control-1-2026-07-28');

CREATE TABLE control.shards (
  shard_id text PRIMARY KEY
    CHECK (shard_id ~ '^[a-z][a-z0-9-]{2,62}$'),
  region text NOT NULL
    CHECK (region ~ '^[a-z][a-z0-9-]{1,62}$'),
  secret_resource text NOT NULL UNIQUE
    CHECK (secret_resource ~ '^projects/[^/]+/secrets/[^/]+$'),
  state text NOT NULL DEFAULT 'active'
    CHECK (state IN ('provisioning', 'active', 'draining', 'disabled')),
  schema_version text NOT NULL,
  capacity_weight integer NOT NULL DEFAULT 100
    CHECK (capacity_weight BETWEEN 0 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE control.identities (
  user_id uuid PRIMARY KEY,
  issuer text NOT NULL CHECK (length(issuer) BETWEEN 1 AND 2048),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 512),
  normalized_email text,
  email_verified boolean NOT NULL DEFAULT false,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (issuer, subject),
  CHECK (
    normalized_email IS NULL
    OR (
      normalized_email = lower(btrim(normalized_email))
      AND normalized_email ~ '^[^[:space:]@]+@[^[:space:]@]+$'
    )
  )
);

CREATE TABLE control.companies (
  company_uuid uuid PRIMARY KEY,
  public_company_id bigint NOT NULL UNIQUE CHECK (public_company_id > 0),
  shard_id text NOT NULL REFERENCES control.shards(shard_id),
  normalized_vat_number text UNIQUE,
  state text NOT NULL DEFAULT 'provisioning'
    CHECK (state IN ('provisioning', 'active', 'moving', 'disabled')),
  routing_version bigint NOT NULL DEFAULT 1 CHECK (routing_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    normalized_vat_number IS NULL
    OR normalized_vat_number = regexp_replace(normalized_vat_number, '[^0-9]', '', 'g')
  )
);

CREATE INDEX companies_shard_state_idx
  ON control.companies (shard_id, state, public_company_id);

CREATE TABLE control.memberships (
  user_id uuid NOT NULL REFERENCES control.identities(user_id),
  company_uuid uuid NOT NULL REFERENCES control.companies(company_uuid),
  member_no bigint NOT NULL CHECK (member_no > 0),
  role text NOT NULL CHECK (role IN ('manager', 'worker', 'user', 'basic', 'dev')),
  state text NOT NULL DEFAULT 'active'
    CHECK (state IN ('invited', 'active', 'disabled')),
  projection_version bigint NOT NULL CHECK (projection_version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, company_uuid),
  UNIQUE (company_uuid, member_no)
);

CREATE INDEX memberships_user_state_idx
  ON control.memberships (user_id, state, company_uuid);

CREATE TABLE control.provisioning_operations (
  operation_id uuid PRIMARY KEY,
  idempotency_key uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES control.identities(user_id),
  company_uuid uuid NOT NULL UNIQUE REFERENCES control.companies(company_uuid),
  operation_type text NOT NULL
    CHECK (operation_type IN ('create_company', 'move_company')),
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'tenant_committed', 'control_committed', 'failed')),
  failure_code text,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);

CREATE OR REPLACE FUNCTION private.resolve_company_route(
  requested_public_company_id bigint,
  requested_user_id uuid
)
RETURNS TABLE (
  company_uuid uuid,
  shard_id text,
  role text,
  routing_version bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, control
AS $$
  SELECT
    company.company_uuid,
    company.shard_id,
    membership.role,
    company.routing_version
  FROM control.companies AS company
  INNER JOIN control.shards AS shard
    ON shard.shard_id = company.shard_id
  INNER JOIN control.memberships AS membership
    ON membership.company_uuid = company.company_uuid
   AND membership.user_id = requested_user_id
  INNER JOIN control.identities AS identity
    ON identity.user_id = membership.user_id
  WHERE company.public_company_id = requested_public_company_id
    AND company.state = 'active'
    AND shard.state = 'active'
    AND membership.state = 'active'
    AND identity.disabled_at IS NULL
$$;

CREATE OR REPLACE FUNCTION private.list_user_workspace_routes(
  requested_user_id uuid
)
RETURNS TABLE (
  company_uuid uuid,
  public_company_id bigint,
  shard_id text,
  member_no bigint,
  role text,
  routing_version bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, control
AS $$
  SELECT
    company.company_uuid,
    company.public_company_id,
    company.shard_id,
    membership.member_no,
    membership.role,
    company.routing_version
  FROM control.memberships AS membership
  INNER JOIN control.companies AS company
    ON company.company_uuid = membership.company_uuid
  INNER JOIN control.shards AS shard
    ON shard.shard_id = company.shard_id
  INNER JOIN control.identities AS identity
    ON identity.user_id = membership.user_id
  WHERE membership.user_id = requested_user_id
    AND membership.state = 'active'
    AND company.state = 'active'
    AND shard.state = 'active'
    AND identity.disabled_at IS NULL
  ORDER BY company.public_company_id
$$;

CREATE OR REPLACE FUNCTION private.check_control_readiness(
  expected_schema_version text
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, control
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM control.schema_metadata
    WHERE singleton
      AND schema_version = expected_schema_version
  )
$$;

REVOKE ALL ON SCHEMA control, private FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA control FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA private FROM PUBLIC;

GRANT USAGE ON SCHEMA private TO smart_job_control_api;
GRANT EXECUTE ON FUNCTION private.resolve_company_route(bigint, uuid)
  TO smart_job_control_api;
GRANT EXECUTE ON FUNCTION private.list_user_workspace_routes(uuid)
  TO smart_job_control_api;
GRANT EXECUTE ON FUNCTION private.check_control_readiness(text)
  TO smart_job_control_api;

COMMIT;
