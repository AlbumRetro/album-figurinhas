ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS last_daily_claim TIMESTAMP WITH TIME ZONE;

CREATE OR REPLACE FUNCTION claim_daily_bonus(p_bonus_amount INT DEFAULT 200)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_last_claim TIMESTAMP WITH TIME ZONE;
  v_new_balance INT;
  v_next_available TIMESTAMP WITH TIME ZONE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Usuário não autenticado.';
  END IF;

  SELECT last_daily_claim INTO v_last_claim
  FROM profiles
  WHERE id = v_user_id;

  IF v_last_claim IS NOT NULL AND NOW() < (v_last_claim + INTERVAL '24 hours') THEN
    v_next_available := v_last_claim + INTERVAL '24 hours';
    RAISE EXCEPTION 'Bônus diário já resgatado! Próximo resgate disponível às %', to_char(v_next_available, 'HH24:MI:SS DD/MM/YYYY');
  END IF;

  UPDATE profiles
  SET 
    global_points = global_points + p_bonus_amount,
    last_daily_claim = NOW()
  WHERE id = v_user_id
  RETURNING global_points INTO v_new_balance;

  RETURN jsonb_build_object(
    'success', true,
    'earned_points', p_bonus_amount,
    'new_balance', v_new_balance,
    'next_claim_at', NOW() + INTERVAL '24 hours'
  );
END;
$$;
