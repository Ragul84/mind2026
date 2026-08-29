-- ============================================================
-- MINDWHITE SECURITY HARDENING — Run in Supabase SQL Editor
-- ============================================================

-- STEP 1: Add secure RPC functions for XP/subscription updates
-- (Only these SECURITY DEFINER functions can touch sensitive columns)

CREATE OR REPLACE FUNCTION public.award_user_rewards(
  p_user_id UUID,
  p_xp_amount INTEGER,
  p_reason TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS INTEGER  -- returns new total_xp
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_xp INTEGER;
BEGIN
  UPDATE user_profiles
  SET total_xp = COALESCE(total_xp, 0) + p_xp_amount
  WHERE id = p_user_id
  RETURNING total_xp INTO v_new_xp;

  IF p_xp_amount != 0 THEN
    INSERT INTO user_transactions (user_id, amount, currency_type, transaction_type, metadata)
    VALUES (p_user_id, p_xp_amount, 'xp', p_reason, p_metadata);
  END IF;

  RETURN v_new_xp;
END;
$$;

-- STEP 2: Secure subscription upgrade (only callable server-side / edge function)
CREATE OR REPLACE FUNCTION public.activate_premium(
  p_user_id UUID,
  p_tier TEXT,
  p_expires_at TIMESTAMPTZ,
  p_purchase_token TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE user_profiles
  SET
    subscription_tier = p_tier,
    premium_expires_at = p_expires_at,
    updated_at = now()
  WHERE id = p_user_id;

  INSERT INTO user_transactions (user_id, amount, currency_type, transaction_type, metadata)
  VALUES (p_user_id, 0, 'mg', 'subscription_' || p_tier,
    jsonb_build_object('tier', p_tier, 'expires_at', p_expires_at, 'token', p_purchase_token));
END;
$$;

-- STEP 3: Column guard trigger — blocks direct client writes to sensitive columns
CREATE OR REPLACE FUNCTION public.guard_sensitive_columns()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Block if NOT called from a SECURITY DEFINER function
  -- We detect this by checking if our special session var is set
  IF current_setting('app.trusted_context', true) IS DISTINCT FROM 'true' THEN
    IF NEW.total_xp IS DISTINCT FROM OLD.total_xp THEN
      RAISE EXCEPTION 'Direct XP modification blocked. Use award_user_rewards() RPC.';
    END IF;
    IF NEW.subscription_tier IS DISTINCT FROM OLD.subscription_tier THEN
      RAISE EXCEPTION 'Direct subscription_tier change blocked. Use activate_premium() RPC.';
    END IF;
    IF NEW.gems IS DISTINCT FROM OLD.gems THEN
      RAISE EXCEPTION 'Direct gems modification blocked.';
    END IF;
    IF NEW.premium_expires_at IS DISTINCT FROM OLD.premium_expires_at THEN
      RAISE EXCEPTION 'Direct premium_expires_at change blocked.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- Set the trusted context flag inside our SECURITY DEFINER functions
-- (Recreate award_user_rewards with the flag)
CREATE OR REPLACE FUNCTION public.award_user_rewards(
  p_user_id UUID,
  p_xp_amount INTEGER,
  p_reason TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_xp INTEGER;
BEGIN
  PERFORM set_config('app.trusted_context', 'true', true); -- local to transaction

  UPDATE user_profiles
  SET total_xp = COALESCE(total_xp, 0) + p_xp_amount
  WHERE id = p_user_id
  RETURNING total_xp INTO v_new_xp;

  PERFORM set_config('app.trusted_context', 'false', true);

  IF p_xp_amount != 0 THEN
    INSERT INTO user_transactions (user_id, amount, currency_type, transaction_type, metadata)
    VALUES (p_user_id, p_xp_amount, 'xp', p_reason, p_metadata);
  END IF;

  RETURN COALESCE(v_new_xp, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.activate_premium(
  p_user_id UUID,
  p_tier TEXT,
  p_expires_at TIMESTAMPTZ,
  p_purchase_token TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM set_config('app.trusted_context', 'true', true);

  UPDATE user_profiles
  SET
    subscription_tier = p_tier,
    premium_expires_at = p_expires_at,
    updated_at = now()
  WHERE id = p_user_id;

  PERFORM set_config('app.trusted_context', 'false', true);

  INSERT INTO user_transactions (user_id, amount, currency_type, transaction_type, metadata)
  VALUES (p_user_id, 0, 'mg', 'subscription_' || p_tier,
    jsonb_build_object('tier', p_tier, 'expires_at', p_expires_at, 'token', p_purchase_token));
END;
$$;

-- Attach trigger
DROP TRIGGER IF EXISTS guard_sensitive_cols ON public.user_profiles;
CREATE TRIGGER guard_sensitive_cols
  BEFORE UPDATE ON public.user_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_sensitive_columns();

-- STEP 4: Table to store verified purchase tokens (prevents replay attacks)
CREATE TABLE IF NOT EXISTS public.verified_purchases (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  purchase_token TEXT UNIQUE NOT NULL,
  product_id TEXT NOT NULL,
  order_id TEXT,
  purchase_state INTEGER,
  verified_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ
);

ALTER TABLE public.verified_purchases ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can view own purchases" ON public.verified_purchases
  FOR SELECT USING (auth.uid() = user_id);
-- No INSERT/UPDATE/DELETE from client — only edge functions can write

GRANT SELECT ON public.verified_purchases TO authenticated;
