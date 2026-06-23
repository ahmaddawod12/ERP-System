-- Phase 2: add explicit search_path to security-sensitive functions that lacked it.

CREATE OR REPLACE FUNCTION public.app_auth_uid()
RETURNS text
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '');
$$;

CREATE OR REPLACE FUNCTION public.prevent_company_profile_vat_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.vat_number IS NOT NULL AND NEW.vat_number IS DISTINCT FROM OLD.vat_number THEN
    RAISE EXCEPTION 'vat_number is immutable after initial set';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_document_number_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.document_number > 0 AND NEW.document_number IS DISTINCT FROM OLD.document_number THEN
    RAISE EXCEPTION 'document_number is immutable once assigned';
  END IF;
  IF OLD.document_number > 0 AND NEW.document_code IS DISTINCT FROM OLD.document_code THEN
    RAISE EXCEPTION 'document_code is immutable once assigned';
  END IF;
  RETURN NEW;
END;
$$;
