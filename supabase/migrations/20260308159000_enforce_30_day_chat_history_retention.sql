-- Keep chat history for 30 days only.
-- This migration:
-- 1) Enforces 30-day visibility through RLS on direct_messages.
-- 2) Adds a cleanup function to remove expired chat data.
-- 3) Executes cleanup once during migration.

CREATE INDEX IF NOT EXISTS idx_direct_messages_created_at
ON public.direct_messages (created_at DESC);

DROP POLICY IF EXISTS "Users can view own direct messages" ON public.direct_messages;
CREATE POLICY "Users can view own direct messages"
  ON public.direct_messages FOR SELECT
  USING (
    (auth.uid() = sender_id OR auth.uid() = recipient_id OR public.is_admin(auth.uid()))
    AND created_at >= (now() - INTERVAL '30 days')
  );

CREATE OR REPLACE FUNCTION public.purge_expired_direct_messages(p_retention_days INT DEFAULT 30)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_retention_days INT := GREATEST(COALESCE(p_retention_days, 30), 1);
  v_deleted_messages INT := 0;
BEGIN
  DELETE FROM public.direct_messages dm
  WHERE dm.created_at < now() - make_interval(days => v_retention_days);

  GET DIAGNOSTICS v_deleted_messages = ROW_COUNT;

  DELETE FROM public.direct_conversations dc
  WHERE dc.status = 'closed'
    AND dc.updated_at < now() - make_interval(days => v_retention_days)
    AND NOT EXISTS (
      SELECT 1
      FROM public.direct_messages dm
      WHERE dm.conversation_id = dc.id
    );

  RETURN COALESCE(v_deleted_messages, 0);
END;
$$;

DO $$
BEGIN
  PERFORM public.purge_expired_direct_messages(30);
END;
$$;

