-- Lock direct writes on plan_orders and allow only RPC-based flow.

-- 1) Remove any residual write policies that could allow direct DML.
DROP POLICY IF EXISTS "Students can insert own plan orders" ON public.plan_orders;
DROP POLICY IF EXISTS "Students can update own plan orders" ON public.plan_orders;
DROP POLICY IF EXISTS "Students can delete own plan orders" ON public.plan_orders;
DROP POLICY IF EXISTS "Users can insert own plan orders" ON public.plan_orders;
DROP POLICY IF EXISTS "Users can update own plan orders" ON public.plan_orders;
DROP POLICY IF EXISTS "Users can delete own plan orders" ON public.plan_orders;
DROP POLICY IF EXISTS "Admins can update all plan orders" ON public.plan_orders;
DROP POLICY IF EXISTS "Admins can delete all plan orders" ON public.plan_orders;
DROP POLICY IF EXISTS "Admins can insert all plan orders" ON public.plan_orders;

-- 2) Revoke direct table writes for API roles.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.plan_orders FROM anon, authenticated;

-- Keep reads through RLS policies.
GRANT SELECT ON TABLE public.plan_orders TO authenticated;

-- 3) Restrict RPC execution scope (no direct public execute).
REVOKE EXECUTE ON FUNCTION public.create_fixed_plan_order(UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_custom_plan_order(TEXT, INT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.mark_plan_order_payment(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.review_plan_order(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.expire_stale_plan_orders(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_fixed_plan_order(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_custom_plan_order(TEXT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_plan_order_payment(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_plan_order(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.expire_stale_plan_orders(UUID) TO authenticated;

GRANT EXECUTE ON FUNCTION public.create_fixed_plan_order(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.create_custom_plan_order(TEXT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.mark_plan_order_payment(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.review_plan_order(UUID, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.expire_stale_plan_orders(UUID) TO service_role;
