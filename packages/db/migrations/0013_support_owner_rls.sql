-- 0013_support_owner_rls.sql
-- Restrict personal support conversations/messages to the owning user or dev admins.

DROP POLICY IF EXISTS support_conversations_company_read_policy ON support_conversations;
DROP POLICY IF EXISTS support_conversations_owner_read_policy ON support_conversations;
CREATE POLICY support_conversations_owner_read_policy
  ON support_conversations
  FOR SELECT
  USING (app_is_dev() OR user_id = app_auth_uid());

DROP POLICY IF EXISTS support_messages_company_read_policy ON support_messages;
DROP POLICY IF EXISTS support_messages_owner_read_policy ON support_messages;
CREATE POLICY support_messages_owner_read_policy
  ON support_messages
  FOR SELECT
  USING (
    app_is_dev()
    OR EXISTS (
      SELECT 1
      FROM support_conversations c
      WHERE c.id = support_messages.conversation_id
        AND c.user_id = app_auth_uid()
    )
  );
