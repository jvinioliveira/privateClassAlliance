-- Fix recursive RLS evaluation for profiles admin select policy.
-- The old policy queried public.profiles inside a policy on public.profiles.

DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;

CREATE POLICY "Admins can view all profiles"
  ON public.profiles
  FOR SELECT
  USING (public.is_admin(auth.uid()));

