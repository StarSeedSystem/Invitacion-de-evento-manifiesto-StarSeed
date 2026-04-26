// ═══════════════════════════════════════════════════════════════════════
//  StarSeed · Edge Function: mp-webhook
//  Recibe notificaciones IPN de MercadoPago y actualiza el estado del
//  pago en la tabla `tickets` de Supabase.
//
//  Deploy:
//    supabase functions deploy mp-webhook --no-verify-jwt
//
//  Variables de entorno requeridas (Supabase → Settings → Secrets):
//    MP_ACCESS_TOKEN    — Access Token de MercadoPago (mismo que create-mp-preference)
//    SUPABASE_URL       — URL del proyecto (automática en Edge Functions)
//    SUPABASE_SERVICE_ROLE_KEY — Service-role key (automática en Edge Functions)
//
//  En MercadoPago Dashboard → Notificaciones → Webhook URL:
//    https://<proyecto>.supabase.co/functions/v1/mp-webhook
// ═══════════════════════════════════════════════════════════════════════

import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST')
    return new Response('Method not allowed', { status: 405, headers: CORS });

  const MP_ACCESS_TOKEN       = Deno.env.get('MP_ACCESS_TOKEN');
  const SUPABASE_URL          = Deno.env.get('SUPABASE_URL');
  const SUPABASE_SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!MP_ACCESS_TOKEN || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('[mp-webhook] Variables de entorno faltantes');
    return new Response('Server misconfigured', { status: 500, headers: CORS });
  }

  // ── 1. Parsear body ──────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return new Response('Invalid JSON', { status: 400, headers: CORS });
  }

  const { type, data } = body as { type?: string; data?: { id?: string } };

  // Solo procesamos notificaciones de tipo 'payment'
  if (type !== 'payment' || !data?.id) {
    return new Response('OK (ignored)', { status: 200, headers: CORS });
  }

  const paymentId = String(data.id);

  // ── 2. Consultar MercadoPago para obtener datos del pago ─────────────
  const mpResp = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Bearer ${MP_ACCESS_TOKEN}` },
  });

  if (!mpResp.ok) {
    console.error('[mp-webhook] Error consultando MP:', await mpResp.text());
    return new Response('MP API error', { status: 502, headers: CORS });
  }

  const payment = await mpResp.json();
  const { status: mpStatus, external_reference: txnId } = payment as {
    status: string;
    external_reference: string;
  };

  if (!txnId) {
    console.warn('[mp-webhook] Sin external_reference — ignorando');
    return new Response('OK (no ref)', { status: 200, headers: CORS });
  }

  // ── 3. Mapear estado MP → estado interno ─────────────────────────────
  const statusMap: Record<string, string> = {
    approved: 'paid',
    pending:  'pending_mp',
    rejected: 'failed',
    cancelled:'failed',
    refunded: 'refunded',
    in_process: 'pending_mp',
  };
  const donStatus = statusMap[mpStatus] ?? 'pending_mp';

  // ── 4. Actualizar en Supabase ─────────────────────────────────────────
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { error } = await supabase
    .from('tickets')
    .update({
      don_status:  donStatus,
      don_txn_id:  paymentId,   // MP payment ID
    })
    .eq('don_txn_id', txnId);   // buscar por nuestro TX-xxx en don_txn_id

  if (error) {
    // Si aún no existe el ticket (ej. webhook llegó antes que el browser),
    // log y responde 200 para que MP no reintente en loop
    console.error('[mp-webhook] Supabase update error:', error);
  } else {
    console.log(`[mp-webhook] Ticket ${txnId} → ${donStatus} (MP ${paymentId})`);
  }

  return new Response(JSON.stringify({ ok: true, txnId, donStatus }),
    { status: 200, headers: { ...CORS, 'Content-Type': 'application/json' } });
});
