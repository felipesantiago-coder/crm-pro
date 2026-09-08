import { db } from '@/lib/db';
import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/api-auth';
import {
  buildAppAccessToken,
  isSubscriptionFieldActive,
  normalizeSubscriptionFields,
} from '@/lib/meta-app-subscription';

// ============================================================
// POST /api/meta-ad-accounts/[id]/subscribe-app-webhook
//
// Registra na META o webhook do NÍVEL DO APP desta conta
// (POST /{app-id}/subscriptions com object=page, field=leadgen,
// callback_url do CRM e verify_token da conta) — o último elo da
// cadeia: página inscrita no app (subscribe-page) leva o evento ao
// app, mas é ESTE registro que diz ao Meta PARA ONDE entregar.
// Sem ele: zero entregas, zero leads perdidos, diagnóstico todo
// verde — o sintoma "só polling funciona".
//
// App id: derivado do access token da conta via debug_token (o
// mesmo app cuja inscrição leadgen a página aponta).
// App access token: app_id|app_secret — exige o App Secret EXATO
// salvo na aba Webhook (o mesmo que valida as assinaturas HMAC).
// Verify token: o dedicado DESTA conta — o webhook do CRM só
// aceita verify tokens dedicados de contas com webhook ativo.
// ============================================================

export const maxDuration = 30;

const GRAPH_API_BASE = 'https://graph.facebook.com/v26.0';
const TIMEOUT_MS = 8_000;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { error } = await requireAdmin();
  if (error) return error;

  const { id } = await params;

  const account = await db.metaAdAccount.findUnique({ where: { id } });
  if (!account) {
    return NextResponse.json({ error: 'Conta de anúncios não encontrada' }, { status: 404 });
  }
  if (!account.accessToken) {
    return NextResponse.json(
      { error: 'Conta sem access token — salve o token no card desta conta primeiro' },
      { status: 400 },
    );
  }
  if (!account.appSecret) {
    return NextResponse.json(
      { error: 'Conta sem App Secret — salve o App Secret do app (Meta for Developers → Configurações → Básico) na aba Webhook desta conta antes de assinar' },
      { status: 400 },
    );
  }
  if (!account.verifyToken) {
    return NextResponse.json(
      { error: 'Conta sem verify token — o webhook do CRM só aceita verify tokens dedicados de contas; salve o verify token desta conta na aba Webhook antes de assinar' },
      { status: 400 },
    );
  }
  if (account.webhookEnabled === false) {
    return NextResponse.json(
      { error: 'Webhook próprio desta conta está DESLIGADO — ative o toggle na aba Webhook antes de assinar' },
      { status: 400 },
    );
  }

  // 1. App id desta conta (emissor do token salvo)
  const appIdRes = await graphCall('GET', `debug_token?input_token=${encodeURIComponent(account.accessToken)}`, account.accessToken);
  const appId = appIdRes.ok ? appIdRes.data?.data?.app_id : null;
  if (typeof appId !== 'string' || !appId) {
    return NextResponse.json(
      { error: `Não foi possível determinar o app id desta conta (debug_token falhou: ${appIdRes.error || 'resposta sem app_id'})` },
      { status: 400 },
    );
  }

  // 2. Callback URL pública do CRM
  const host = request.headers.get('x-forwarded-host') || request.headers.get('host');
  const proto = request.headers.get('x-forwarded-proto') || (host?.startsWith('localhost') ? 'http' : 'https');
  const origin = process.env.NEXT_PUBLIC_APP_URL || (host ? `${proto}://${host}` : '');
  if (!origin) {
    return NextResponse.json(
      { error: 'Origem pública do servidor não determinável — defina NEXT_PUBLIC_APP_URL' },
      { status: 400 },
    );
  }
  const callbackUrl = `${origin}/api/webhooks/meta-leads`;

  // 3. App access token — já valida o App Secret contra a Graph API
  const appToken = buildAppAccessToken(appId, account.appSecret);

  // 4. Registra/reativa o webhook Page/leadgen do app
  const qs = new URLSearchParams({
    object: 'page',
    callback_url: callbackUrl,
    verify_token: account.verifyToken,
    fields: 'leadgen',
  });
  const post = await graphCall('POST', `${appId}/subscriptions?${qs.toString()}`, appToken);
  if (!post.ok) {
    const code = typeof post.data?.error?.code === 'number' ? post.data.error.code : null;
    const message = post.data?.error?.message || post.error || 'HTTP error ao assinar o webhook do app';
    const hint =
      code === 190
        ? 'O App Secret salvo NÃO confere com o app emissor do token — copie o App Secret EXATO de Meta for Developers → app → Configurações → Básico, salve na aba Webhook e tente de novo.'
        : 'Confira se o app id está correto e se você tem acesso de administrador ao app; ou registre manualmente em Meta for Developers → Webhooks → Page (campo leadgen).';
    return NextResponse.json({ ok: false, error: `${message} — ${hint}` }, { status: 400 });
  }

  // 5. Confirmação: lê de volta a assinatura
  //    ATENÇÃO: a Graph API devolve fields como OBJETOS { name, active,
  //    version } — normalizar antes de checar/juntar (join direto rende
  //    "[object Object]" e includes('leadgen') nunca casa — bug que
  //    reportava "INCOMPLETA" com a assinatura perfeitamente ativa).
  const confirm = await graphCall('GET', `${appId}/subscriptions`, appToken);
  const rows: Array<{ object?: string; callback_url?: string; fields?: Array<string | { name?: string; active?: boolean; version?: string }>; active?: boolean }> =
    Array.isArray(confirm.data?.data) ? confirm.data.data : [];
  const page = rows.find((r) => r?.object === 'page') || null;
  if (!page) {
    return NextResponse.json({
      ok: true,
      appId,
      callbackUrl,
      confirmed: false,
      message: 'Assinatura enviada para a Meta — reexecute o diagnóstico para confirmar a ativação',
    });
  }

  const fieldNames = normalizeSubscriptionFields(page.fields);
  const leadgenFieldInactive = isSubscriptionFieldActive(page.fields, 'leadgen') === false;
  const hasLeadgen = fieldNames.includes('leadgen');
  if (!hasLeadgen || leadgenFieldInactive || page.active === false) {
    return NextResponse.json({
      ok: true,
      appId,
      callbackUrl,
      confirmed: false,
      message: `Assinatura registrada, porém INCOMPLETA (campos: ${fieldNames.join(', ') || 'nenhum'}, leadgen ativo no campo: ${hasLeadgen && !leadgenFieldInactive ? 'sim' : 'não'}, assinatura ativa: ${page.active === false ? 'não' : 'sim'}) — reexecute o diagnóstico e, se persistir, registre manualmente em Meta for Developers → Webhooks → Page`,
    });
  }

  return NextResponse.json({
    ok: true,
    appId,
    callbackUrl,
    confirmed: true,
    message: `Webhook Page/leadgen ATIVO no app ${appId} com callback ${callbackUrl} — o Meta já tem para onde entregar os leads desta página. Reexecute o diagnóstico para confirmar a cadeia completa.`,
  });
}

async function graphCall(
  method: 'GET' | 'POST',
  pathWithQuery: string,
  token: string,
): Promise<{ ok: boolean; status?: number; data: any; error?: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = `${GRAPH_API_BASE}/${pathWithQuery}${pathWithQuery.includes('?') ? '&' : '?'}access_token=${encodeURIComponent(token)}`;
    const res = await fetch(url, { method, signal: controller.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, status: res.status, data, error: data?.error?.message || `HTTP ${res.status}` };
    }
    return { ok: true, data };
  } catch (err) {
    return { ok: false, data: null, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timeoutId);
  }
}
