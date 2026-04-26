// ═══════════════════════════════════════════════════════════════════════
//  StarSeed · Edge Function: create-mp-preference
//  Crea una preferencia de pago en MercadoPago y devuelve el init_point
//  para redirigir al usuario al checkout hosted de MP.
//
//  Deploy:
//    supabase functions deploy create-mp-preference --no-verify-jwt
//
//  Variables de entorno requeridas (Supabase → Settings → Secrets):
//    MP_ACCESS_TOKEN   — Access Token de MercadoPago (producción o sandbox)
// ═══════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST')
    return new Response('Method not allowed', { status: 405, headers: CORS });

  const MP_ACCESS_TOKEN = Deno.env.get('MP_ACCESS_TOKEN');
  if (!MP_ACCESS_TOKEN)
    return new Response(JSON.stringify({ error: 'MP_ACCESS_TOKEN not configured' }),
      { status: 500, headers: { ...CORS, 'Content-Type': 'application/json' } });

  let body: {
    amount: number;
    description?: string;
    email?: string;
    external_ref?: string;
    back_url?: string;
  };

  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const { amount, description, email, external_ref, back_url } = body;
  if (!amount || amount < 1)
    return new Response(JSON.stringify({ error: 'amount required (min 1)' }),
      { status: 400, headers: { ...CORS, 'Content-Type': 'application/json' } });

  // Construir preferencia MercadoPago
  const preference = {
    items: [{
      id: external_ref || crypto.randomUUID(),
      title: description || 'Aportación · Evento Manifiesto StarSeed',
      quantity: 1,
      unit_price: Number(amount),
      currency_id: 'MXN',
    }],
    payer: email ? { email } : undefined,
    external_reference: external_ref || '',
    back_urls: {
      success: back_url ? `${back_url}?mp_status=success&txn=${external_ref}` : undefined,
      failure: back_url ? `${back_url}?mp_status=failure&txn=${external_ref}` : undefined,
      pending: back_url ? `${back_url}?mp_status=pending&txn=${external_ref}` : undefined,
    },
    auto_return: 'approved',
    statement_descriptor: 'STARSEED EVENTO',
    expires: false,
  };

  const mpResp = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${MP_ACCESS_TOKEN}`,
    },
    body: JSON.stringify(preference),
  });

  if (!mpResp.ok) {
    const err = await mpResp.text();
    return new Response(JSON.stringify({ error: 'MP API error', detail: err }),
      { status: 502, headers: { ...CORS, 'Content-Type': 'application/json' } });
  }

  const data = await mpResp.json();
  return new Response(
    JSON.stringify({ init_point: data.init_point, id: data.id }),
    { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } },
  );
});
