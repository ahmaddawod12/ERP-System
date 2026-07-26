-- Enforce the canonical receipt payment structure independently of the API.
-- Existing payloads remain readable; the trigger applies only to new payload
-- writes and intentionally does not rewrite historical free-text values.

CREATE OR REPLACE FUNCTION private.contains_likely_payment_pan(
  p_value TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v_match TEXT[];
  v_digits TEXT;
  v_sum INTEGER;
  v_digit INTEGER;
  v_double BOOLEAN;
  v_index INTEGER;
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.document_type IS NOT DISTINCT FROM NEW.document_type
     AND OLD.payload IS NOT DISTINCT FROM NEW.payload THEN
    RETURN NEW;
  END IF;

  IF p_value IS NULL OR p_value = '' THEN
    RETURN false;
  END IF;

  FOR v_match IN
    SELECT candidate
    FROM pg_catalog.regexp_matches(
      p_value,
      '([0-9][0-9 -]{11,35}[0-9])',
      'g'
    ) AS candidate
  LOOP
    v_digits := pg_catalog.regexp_replace(v_match[1], '[^0-9]', '', 'g');
    IF pg_catalog.char_length(v_digits) BETWEEN 13 AND 19 THEN
      v_sum := 0;
      v_double := false;
      FOR v_index IN REVERSE pg_catalog.char_length(v_digits)..1 LOOP
        v_digit := pg_catalog.substring(v_digits FROM v_index FOR 1)::INTEGER;
        IF v_double THEN
          v_digit := v_digit * 2;
          IF v_digit > 9 THEN v_digit := v_digit - 9; END IF;
        END IF;
        v_sum := v_sum + v_digit;
        v_double := NOT v_double;
      END LOOP;
      IF v_sum % 10 = 0 THEN RETURN true; END IF;
    END IF;
  END LOOP;
  RETURN false;
END;
$$;
--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.enforce_document_payment_metadata()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_method TEXT := NEW.payload ->> 'paymentMethod';
  v_details JSONB := NEW.payload -> 'paymentDetails';
  v_reference TEXT;
BEGIN
  IF NEW.document_type <> 400 THEN
    IF NEW.payload ? 'paymentMethod'
       OR NEW.payload ? 'paymentDetails'
       OR NEW.payload ? 'paymentInfo' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PAYMENT_METADATA_DOCUMENT_TYPE_INVALID';
    END IF;
    RETURN NEW;
  END IF;

  IF v_method IS NULL
     OR v_method NOT IN ('cash', 'credit', 'transfer', 'check', 'bit', 'paybox')
     OR NEW.payload ? 'paymentInfo' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PAYMENT_METADATA_INVALID';
  END IF;

  IF v_method = 'cash' THEN
    IF v_details IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PAYMENT_METADATA_CASH_DETAILS_FORBIDDEN';
    END IF;
    RETURN NEW;
  END IF;

  IF v_details IS NULL OR pg_catalog.jsonb_typeof(v_details) <> 'object' THEN
    IF v_method = 'credit' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PAYMENT_METADATA_CREDIT_DETAILS_REQUIRED';
    END IF;
    RETURN NEW;
  END IF;

  IF v_method = 'credit' THEN
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_object_keys(v_details) AS key(name)
      WHERE key.name NOT IN ('last4', 'authorizationReference')
    )
       OR pg_catalog.jsonb_typeof(v_details -> 'last4') <> 'string'
       OR COALESCE(v_details ->> 'last4', '') !~ '^[0-9]{4}$'
       OR pg_catalog.jsonb_typeof(v_details -> 'authorizationReference') <> 'string'
       OR pg_catalog.char_length(pg_catalog.btrim(v_details ->> 'authorizationReference'))
            NOT BETWEEN 1 AND 128
       OR (v_details ->> 'authorizationReference') ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PAYMENT_METADATA_CREDIT_DETAILS_INVALID';
    END IF;
    v_reference := v_details ->> 'authorizationReference';
  ELSE
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.jsonb_object_keys(v_details) AS key(name)
      WHERE key.name <> 'reference'
    )
       OR pg_catalog.jsonb_typeof(v_details -> 'reference') <> 'string'
       OR pg_catalog.char_length(pg_catalog.btrim(v_details ->> 'reference'))
            NOT BETWEEN 1 AND 128
       OR (v_details ->> 'reference') ~ '[[:cntrl:]]' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PAYMENT_METADATA_REFERENCE_INVALID';
    END IF;
    v_reference := v_details ->> 'reference';
  END IF;

  IF private.contains_likely_payment_pan(v_reference) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'PAYMENT_METADATA_PAN_FORBIDDEN';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint

DROP TRIGGER IF EXISTS documents_payment_metadata_guard ON public.documents;
CREATE TRIGGER documents_payment_metadata_guard
BEFORE INSERT OR UPDATE OF document_type, payload
ON public.documents
FOR EACH ROW
EXECUTE FUNCTION private.enforce_document_payment_metadata();
--> statement-breakpoint

REVOKE ALL ON FUNCTION private.contains_likely_payment_pan(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.enforce_document_payment_metadata() FROM PUBLIC;
