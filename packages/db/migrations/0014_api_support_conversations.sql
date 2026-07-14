-- Authenticated support-conversation writes for the Node API.
--
-- Public support tables stay read-only to the runtime role. Narrow private
-- functions derive the caller and developer authority from request context,
-- lock each conversation before changing unread counters, and never trust a
-- caller-provided sender or owner identity.

CREATE OR REPLACE FUNCTION private.create_api_support_conversation(
  p_company_id UUID,
  p_category TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid_text TEXT := private.app_auth_uid();
  v_category TEXT := pg_catalog.btrim(p_category);
  v_conversation_id UUID;
BEGIN
  IF v_uid_text IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_REQUIRED';
  END IF;
  IF v_category IS NULL OR v_category NOT IN (
    'general', 'bug', 'opinion', 'suggestion', 'support', 'freeChat'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'SUPPORT_CATEGORY_INVALID';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.app_users AS app_user WHERE app_user.id = v_uid_text
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'SUPPORT_USER_NOT_FOUND';
  END IF;
  IF p_company_id IS NOT NULL AND NOT private.app_has_company_access(p_company_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SUPPORT_COMPANY_ACCESS_DENIED';
  END IF;

  INSERT INTO public.support_conversations (
    user_id,
    company_id,
    category,
    status,
    last_message_text,
    last_message_at,
    unread_for_user_count,
    unread_for_dev_count,
    created_at,
    updated_at
  ) VALUES (
    v_uid_text,
    p_company_id,
    v_category,
    'open',
    '',
    pg_catalog.clock_timestamp(),
    0,
    0,
    pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp()
  )
  RETURNING id INTO v_conversation_id;

  RETURN v_conversation_id;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.append_api_support_message(
  p_conversation_id UUID,
  p_text TEXT
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid_text TEXT := private.app_auth_uid();
  v_text TEXT := pg_catalog.btrim(p_text);
  v_is_dev BOOLEAN;
  v_sender_name TEXT;
  v_sender_type public.support_sender_type;
  v_conversation public.support_conversations%ROWTYPE;
  v_message_id UUID;
  v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
BEGIN
  IF v_uid_text IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_REQUIRED';
  END IF;
  IF p_conversation_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'SUPPORT_CONVERSATION_ID_INVALID';
  END IF;
  IF v_text IS NULL
     OR v_text = ''
     OR pg_catalog.char_length(v_text) > 4000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'SUPPORT_MESSAGE_INVALID';
  END IF;

  SELECT conversation.*
  INTO v_conversation
  FROM public.support_conversations AS conversation
  WHERE conversation.id = p_conversation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'SUPPORT_CONVERSATION_NOT_FOUND';
  END IF;

  SELECT
    private.app_is_dev(),
    pg_catalog.left(
      COALESCE(
        NULLIF(pg_catalog.btrim(app_user.display_name), ''),
        NULLIF(pg_catalog.btrim(app_user.email), ''),
        v_uid_text
      ),
      200
    )
  INTO v_is_dev, v_sender_name
  FROM public.app_users AS app_user
  WHERE app_user.id = v_uid_text;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'SUPPORT_USER_NOT_FOUND';
  END IF;

  IF NOT v_is_dev AND v_conversation.user_id <> v_uid_text THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SUPPORT_CONVERSATION_ACCESS_DENIED';
  END IF;
  IF v_conversation.status = 'closed' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'SUPPORT_CONVERSATION_CLOSED';
  END IF;

  v_sender_type := CASE
    WHEN v_is_dev THEN 'dev'::public.support_sender_type
    ELSE 'user'::public.support_sender_type
  END;
  INSERT INTO public.support_messages (
    conversation_id,
    sender_user_id,
    sender_type,
    sender_name_snapshot,
    text,
    created_at
  ) VALUES (
    p_conversation_id,
    v_uid_text,
    v_sender_type,
    v_sender_name,
    v_text,
    v_now
  )
  RETURNING id INTO v_message_id;

  UPDATE public.support_conversations AS conversation
  SET
    last_message_text = v_text,
    last_message_at = v_now,
    unread_for_user_count = CASE
      WHEN v_is_dev THEN conversation.unread_for_user_count + 1
      ELSE 0
    END,
    unread_for_dev_count = CASE
      WHEN v_is_dev THEN 0
      ELSE conversation.unread_for_dev_count + 1
    END,
    updated_at = v_now
  WHERE conversation.id = p_conversation_id;

  RETURN v_message_id;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.mark_api_support_conversation_read(
  p_conversation_id UUID
) RETURNS TABLE (
  conversation_id UUID,
  unread_for_user INTEGER,
  unread_for_dev INTEGER,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid_text TEXT := private.app_auth_uid();
  v_is_dev BOOLEAN := private.app_is_dev();
  v_conversation public.support_conversations%ROWTYPE;
BEGIN
  IF v_uid_text IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_REQUIRED';
  END IF;

  SELECT conversation.*
  INTO v_conversation
  FROM public.support_conversations AS conversation
  WHERE conversation.id = p_conversation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'SUPPORT_CONVERSATION_NOT_FOUND';
  END IF;
  IF NOT v_is_dev AND v_conversation.user_id <> v_uid_text THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SUPPORT_CONVERSATION_ACCESS_DENIED';
  END IF;

  UPDATE public.support_conversations AS conversation
  SET
    unread_for_user_count = CASE WHEN v_is_dev THEN conversation.unread_for_user_count ELSE 0 END,
    unread_for_dev_count = CASE WHEN v_is_dev THEN 0 ELSE conversation.unread_for_dev_count END,
    updated_at = pg_catalog.clock_timestamp()
  WHERE conversation.id = p_conversation_id
  RETURNING
    conversation.id,
    conversation.unread_for_user_count,
    conversation.unread_for_dev_count,
    conversation.updated_at
  INTO conversation_id, unread_for_user, unread_for_dev, updated_at;

  RETURN NEXT;
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION private.close_api_support_conversation(
  p_conversation_id UUID
) RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid_text TEXT := private.app_auth_uid();
  v_is_dev BOOLEAN := private.app_is_dev();
  v_conversation public.support_conversations%ROWTYPE;
  v_closed_at TIMESTAMPTZ := pg_catalog.clock_timestamp();
BEGIN
  IF v_uid_text IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'API_CONTEXT_USER_REQUIRED';
  END IF;

  SELECT conversation.*
  INTO v_conversation
  FROM public.support_conversations AS conversation
  WHERE conversation.id = p_conversation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'SUPPORT_CONVERSATION_NOT_FOUND';
  END IF;
  IF NOT v_is_dev AND v_conversation.user_id <> v_uid_text THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'SUPPORT_CONVERSATION_ACCESS_DENIED';
  END IF;

  UPDATE public.support_conversations AS conversation
  SET status = 'closed', updated_at = v_closed_at
  WHERE conversation.id = p_conversation_id;

  RETURN v_closed_at;
END;
$$;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.create_api_support_conversation(UUID, TEXT)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.append_api_support_message(UUID, TEXT)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.mark_api_support_conversation_read(UUID)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

REVOKE ALL ON FUNCTION private.close_api_support_conversation(UUID)
FROM PUBLIC, anon, authenticated, service_role, smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.create_api_support_conversation(UUID, TEXT)
TO smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.append_api_support_message(UUID, TEXT)
TO smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.mark_api_support_conversation_read(UUID)
TO smart_job_api;--> statement-breakpoint

GRANT EXECUTE ON FUNCTION private.close_api_support_conversation(UUID)
TO smart_job_api;
