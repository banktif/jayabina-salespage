-- Enable http extension for external API calls
CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;

-- Function: Create Bayarcash payment intent from database
CREATE OR REPLACE FUNCTION create_bayarcash_payment(
  p_booking_id UUID,
  p_amount INTEGER,
  p_name TEXT,
  p_phone TEXT,
  p_return_url TEXT
) RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_response JSONB;
  v_url TEXT;
BEGIN
  SELECT content::JSONB INTO v_response
  FROM http((
    'POST',
    'https://api.console.bayar.cash/v3/payment-intents',
    ARRAY[http_header('Authorization','Bearer REDACTED_ROTATE_THIS_TOKEN'),
    http_header('Content-Type','application/json')
  ]),
  jsonb_build_object(
    'payment_channel',5,
    'portal_key','4b474a2c15affa36baa329e3c84c4d4',
    'order_number',p_booking_id::TEXT,
    'amount',p_amount,
    'payer_name',p_name,
    'payer_email',p_booking_id::TEXT||'@jbs.local',
    'payer_telephone_number',p_phone,
    'return_url',p_return_url
  )::TEXT,
  'application/json'
  ) AS http_response;

  v_url := v_response->>'url';
  
  IF v_url IS NULL THEN
    RAISE EXCEPTION 'Bayarcash payment creation failed: %', v_response;
  END IF;

  RETURN v_url;
END;
$$;
