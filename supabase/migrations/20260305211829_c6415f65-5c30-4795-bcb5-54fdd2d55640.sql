
-- Fix search_path on functions missing it
ALTER FUNCTION public.get_month_ref(TIMESTAMPTZ) SET search_path = public;
ALTER FUNCTION public.update_updated_at_column() SET search_path = public;
