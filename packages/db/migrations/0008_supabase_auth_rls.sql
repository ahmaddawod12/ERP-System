-- Phase 2: Supabase/Postgres authorization layer
-- Adds membership-aware RLS policies and core immutable-field invariants.

CREATE OR REPLACE FUNCTION app_auth_uid()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '');
$$;

CREATE OR REPLACE FUNCTION app_is_dev()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM app_users u
    WHERE u.id = app_auth_uid()
      AND COALESCE(u.system_role::text, '') = 'dev'
  );
$$;

CREATE OR REPLACE FUNCTION app_has_company_access(target_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM company_memberships m
    WHERE m.company_id = target_company_id
      AND m.user_id = app_auth_uid()
      AND m.status = 'active'
  )
  OR app_is_dev();
$$;

ALTER TABLE company_memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_part_usages ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_job_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE proposal_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE company_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE support_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS company_memberships_company_read_policy ON company_memberships;
CREATE POLICY company_memberships_company_read_policy
  ON company_memberships
  FOR SELECT
  USING (app_has_company_access(company_id) OR user_id = app_auth_uid());

DROP POLICY IF EXISTS company_profiles_company_read_policy ON company_profiles;
CREATE POLICY company_profiles_company_read_policy
  ON company_profiles
  FOR SELECT
  USING (app_has_company_access(company_id));

DROP POLICY IF EXISTS company_subscriptions_company_read_policy ON company_subscriptions;
CREATE POLICY company_subscriptions_company_read_policy
  ON company_subscriptions
  FOR SELECT
  USING (app_has_company_access(company_id));

DROP POLICY IF EXISTS company_sync_state_company_read_policy ON company_sync_state;
CREATE POLICY company_sync_state_company_read_policy
  ON company_sync_state
  FOR SELECT
  USING (app_has_company_access(company_id));

DROP POLICY IF EXISTS clients_company_read_policy ON clients;
CREATE POLICY clients_company_read_policy
  ON clients
  FOR SELECT
  USING (app_has_company_access(company_id));

DROP POLICY IF EXISTS jobs_company_read_policy ON jobs;
CREATE POLICY jobs_company_read_policy
  ON jobs
  FOR SELECT
  USING (app_has_company_access(company_id));

DROP POLICY IF EXISTS job_attachments_company_read_policy ON job_attachments;
CREATE POLICY job_attachments_company_read_policy
  ON job_attachments
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM jobs j
      WHERE j.id = job_attachments.job_id
        AND app_has_company_access(j.company_id)
    )
  );

DROP POLICY IF EXISTS job_part_usages_company_read_policy ON job_part_usages;
CREATE POLICY job_part_usages_company_read_policy
  ON job_part_usages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM jobs j
      WHERE j.id = job_part_usages.job_id
        AND app_has_company_access(j.company_id)
    )
  );

DROP POLICY IF EXISTS inventory_locations_company_read_policy ON inventory_locations;
CREATE POLICY inventory_locations_company_read_policy
  ON inventory_locations
  FOR SELECT
  USING (app_has_company_access(company_id));

DROP POLICY IF EXISTS inventory_parts_company_read_policy ON inventory_parts;
CREATE POLICY inventory_parts_company_read_policy
  ON inventory_parts
  FOR SELECT
  USING (app_has_company_access(company_id));

DROP POLICY IF EXISTS inventory_balances_company_read_policy ON inventory_balances;
CREATE POLICY inventory_balances_company_read_policy
  ON inventory_balances
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM inventory_locations loc
      WHERE loc.id = inventory_balances.location_id
        AND app_has_company_access(loc.company_id)
    )
  );

DROP POLICY IF EXISTS inventory_movements_company_read_policy ON inventory_movements;
CREATE POLICY inventory_movements_company_read_policy
  ON inventory_movements
  FOR SELECT
  USING (app_has_company_access(company_id));

DROP POLICY IF EXISTS documents_company_read_policy ON documents;
CREATE POLICY documents_company_read_policy
  ON documents
  FOR SELECT
  USING (app_has_company_access(company_id));

DROP POLICY IF EXISTS document_items_company_read_policy ON document_items;
CREATE POLICY document_items_company_read_policy
  ON document_items
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM documents d
      WHERE d.id = document_items.document_id
        AND app_has_company_access(d.company_id)
    )
  );

DROP POLICY IF EXISTS document_job_links_company_read_policy ON document_job_links;
CREATE POLICY document_job_links_company_read_policy
  ON document_job_links
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM documents d
      WHERE d.id = document_job_links.document_id
        AND app_has_company_access(d.company_id)
    )
  );

DROP POLICY IF EXISTS proposal_usage_company_read_policy ON proposal_usage;
CREATE POLICY proposal_usage_company_read_policy
  ON proposal_usage
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM documents d
      WHERE d.id = proposal_usage.proposal_id
        AND app_has_company_access(d.company_id)
    )
  );

DROP POLICY IF EXISTS company_invites_company_read_policy ON company_invites;
CREATE POLICY company_invites_company_read_policy
  ON company_invites
  FOR SELECT
  USING (app_has_company_access(company_id));

DROP POLICY IF EXISTS document_tasks_company_read_policy ON document_tasks;
CREATE POLICY document_tasks_company_read_policy
  ON document_tasks
  FOR SELECT
  USING (app_has_company_access(company_id) OR created_by_user_id = app_auth_uid());

DROP POLICY IF EXISTS support_conversations_company_read_policy ON support_conversations;
CREATE POLICY support_conversations_company_read_policy
  ON support_conversations
  FOR SELECT
  USING (app_has_company_access(company_id));

DROP POLICY IF EXISTS support_messages_company_read_policy ON support_messages;
CREATE POLICY support_messages_company_read_policy
  ON support_messages
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM support_conversations c
      WHERE c.id = support_messages.conversation_id
        AND app_has_company_access(c.company_id)
    )
  );

CREATE OR REPLACE FUNCTION prevent_company_profile_vat_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.vat_number IS NOT NULL AND NEW.vat_number IS DISTINCT FROM OLD.vat_number THEN
    RAISE EXCEPTION 'vat_number is immutable after initial set';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_company_profile_vat_immutable ON company_profiles;
CREATE TRIGGER trg_company_profile_vat_immutable
  BEFORE UPDATE ON company_profiles
  FOR EACH ROW
  EXECUTE FUNCTION prevent_company_profile_vat_update();

CREATE OR REPLACE FUNCTION prevent_document_number_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.document_number IS DISTINCT FROM OLD.document_number THEN
    RAISE EXCEPTION 'document_number is immutable';
  END IF;
  IF NEW.document_code IS DISTINCT FROM OLD.document_code THEN
    RAISE EXCEPTION 'document_code is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_document_number_immutable ON documents;
CREATE TRIGGER trg_document_number_immutable
  BEFORE UPDATE ON documents
  FOR EACH ROW
  EXECUTE FUNCTION prevent_document_number_mutation();
