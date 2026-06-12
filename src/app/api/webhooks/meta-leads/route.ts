import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import crypto from 'crypto';

// ============================================================
// Meta Lead Ads Webhook
// Recebe leads de anúncios do Facebook/Instagram e cria
// automaticamente clientes no CRM.
//
// IMPORTANTE: O Meta envia apenas o leadgen_id no webhook.
// Os dados do formulário são buscados via Graph API.
//
// Fluxo:
//   1. Meta envia POST com leadgen_id
//   2. Chamamos Graph API para buscar os dados do lead
//   3. Criamos o cliente automaticamente com stage LEAD
// ============================================================

/**
 * Recupera o verify_token e app_secret das configurações do sistema.
 * Se não existirem, retorna null.
 */
async function getMetaConfig() {
  const settings = await db.userSettings.findMany({
    where: {
      key: {
        in: ['meta_webhook_verify_token', 'meta_app_secret', 'meta_webhook_enabled', 'meta_page_access_token'],
      },
    },
  });

  const map: Record<string, string> = {};
  settings.forEach((s) => {
    map[s.key] = s.value;
  });

  return {
    verifyToken: map['meta_webhook_verify_token'] || null,
    appSecret: map['meta_app_secret'] || null,
    enabled: map['meta_webhook_enabled'] === 'true',
    pageAccessToken: map['meta_page_access_token'] || null,
  };
}

/**
 * Valida a assinatura HMAC-SHA256 do Meta para garantir que
 * o webhook realmente veio do Facebook/Meta.
 *
 * O Meta envia o header X-Hub-Signature-256 no formato:
 *   sha256=HEX_SIGNATURE
 *
 * A assinatura é calculada sobre o corpo bruto da requisição
 * usando o App Secret como chave.
 */
function isValidSignature(payload: string, signature: string | null, appSecret: string): boolean {
  if (!signature || !appSecret) return false;

  const expected = 'sha256=' + crypto
    .createHmac('sha256', appSecret)
    .update(payload, 'utf8')
    .digest('hex');

  // Compara em tempo constante para evitar timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(expected, 'utf8'),
      Buffer.from(signature, 'utf8')
    );
  } catch {
    return false;
  }
}

/**
 * Extrai o valor de um campo do array field_data do Meta.
 * Retorna null se não encontrado.
 */
function getFieldValue(fields: Array<{ name: string; values: string[] }>, fieldName: string): string | null {
  const field = fields.find((f) =>
    f.name.toLowerCase().replace(/[_\s-]/g, '') === fieldName.toLowerCase().replace(/[_\s-]/g, '')
  );
  return field?.values?.[0] || null;
}

/**
 * Formata telefone removendo caracteres não numéricos.
 * Para números brasileiros com 11 dígitos começando com 9,
 * adiciona o código do país (+55).
 */
function formatPhone(phone: string | null): string | null {
  if (!phone) return null;

  const digits = phone.replace(/\D/g, '');

  // Já tem código de país
  if (digits.startsWith('55') && digits.length >= 12) {
    return `+${digits}`;
  }

  // Número brasileiro (11 dígitos com 9 na frente) ou (10 dígitos)
  if (digits.length === 11 || digits.length === 10) {
    return `+55${digits}`;
  }

  // Retorno o que temos, adicionando + se não tiver
  return digits.length > 0 ? `+${digits}` : null;
}

/**
 * Busca os dados completos do lead via Graph API.
 * O webhook do Meta envia apenas o leadgen_id,
 * sem os field_data. Precisamos chamar a API para obter
 * nome, email, telefone, etc.
 */
async function fetchLeadData(leadgenId: string, pageAccessToken: string): Promise<Array<{ name: string; values: string[] }> | null> {
  try {
    const url = `https://graph.facebook.com/v25.0/${leadgenId}?access_token=${encodeURIComponent(pageAccessToken)}&fields=field_data`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Meta Webhook] Erro ao buscar lead ${leadgenId} via Graph API: ${response.status} - ${errorText}`);
      return null;
    }

    const data = await response.json();
    const fieldData = data?.field_data;

    if (!fieldData || !Array.isArray(fieldData)) {
      console.error(`[Meta Webhook] field_data vazio ou inválido na resposta do Graph API para lead ${leadgenId}`);
      return null;
    }

    console.log(`[Meta Webhook] Dados do lead ${leadgenId} obtidos via Graph API (${fieldData.length} campos)`);
    return fieldData;
  } catch (error) {
    console.error(`[Meta Webhook] Falha ao buscar lead ${leadgenId}:`, error);
    return null;
  }
}

/**
 * Verifica se um cliente já existe com o mesmo telefone ou email
 * para evitar duplicatas de leads do mesmo anúncio.
 */
async function findExistingClient(phone: string | null, email: string | null) {
  const conditions: any[] = [];

  if (phone) {
    conditions.push({ phone });
  }
  if (email) {
    conditions.push({ email });
  }

  if (conditions.length === 0) return null;

  const whereClause = conditions.length === 1
    ? conditions[0]
    : { OR: conditions };

  return db.client.findFirst({
    where: whereClause,
    orderBy: { createdAt: 'desc' },
  });
}

// ============================================================
// GET — Verificação do Webhook (hub.challenge)
// O Meta envia esta requisição quando você configura o webhook
// no Facebook Developer / Ads Manager.
// ============================================================
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  // Verificação padrão do Meta
  if (mode === 'subscribe' && token && challenge) {
    const config = await getMetaConfig();

    if (!config.verifyToken) {
      console.warn('[Meta Webhook] Verificação falhou: verify_token não configurado nas Configurações do CRM');
      return NextResponse.json(
        { error: 'Webhook não configurado. Configure o verify_token nas Configurações do CRM.' },
        { status: 403 }
      );
    }

    if (token === config.verifyToken) {
      console.log('[Meta Webhook] Verificação bem-sucedida');
      return new NextResponse(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    console.warn('[Meta Webhook] Verificação falhou: token inválido');
    return NextResponse.json({ error: 'Token inválido' }, { status: 403 });
  }

  // Endpoint de health check simples (para o usuário testar se está ativo)
  const config = await getMetaConfig();
  return NextResponse.json({
    status: 'ok',
    webhook: 'meta-leads',
    enabled: config.enabled,
    hasVerifyToken: !!config.verifyToken,
    hasAppSecret: !!config.appSecret,
    message: config.enabled
      ? 'Webhook ativo e pronto para receber leads do Meta Ads'
      : 'Webhook configurado mas desativado. Ative nas Configurações do CRM.',
  });
}

// ============================================================
// POST — Recebimento de Lead
// O Meta envia esta requisição quando alguém preenche um
// formulário de lead em um anúncio.
// ============================================================
export async function POST(request: NextRequest) {
  try {
    // 1. Verificar se o webhook está ativado
    const config = await getMetaConfig();

    if (!config.enabled) {
      console.log('[Meta Webhook] Recebido POST mas webhook está desativado');
      return NextResponse.json({ received: true, processed: false, reason: 'webhook_disabled' });
    }

    // 2. Validar assinatura HMAC (se app_secret configurado)
    const signature = request.headers.get('x-hub-signature-256');
    const rawBody = await request.text();

    if (config.appSecret) {
      if (!isValidSignature(rawBody, signature, config.appSecret)) {
        console.error('[Meta Webhook] Assinatura inválida — possível tentativa de spoofing');
        return NextResponse.json({ error: 'Assinatura inválida' }, { status: 401 });
      }
    } else {
      console.warn('[Meta Webhook] App Secret não configurado — pulando validação de assinatura. Recomendado configurar para segurança.');
    }

    // 3. Parsear o payload
    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch {
      console.error('[Meta Webhook] Payload JSON inválido');
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
    }

    // 4. Extrair dados do lead do payload
    // Meta envia no formato: { object: "page", entry: [{ changes: [{ value: { field_data, ... } }] }] }
    const entries = body.entry || [];

    if (entries.length === 0) {
      console.log('[Meta Webhook] Nenhum entry no payload');
      return NextResponse.json({ received: true, processed: false, reason: 'empty_entry' });
    }

    const results: Array<{
      success: boolean;
      clientName?: string;
      reason?: string;
      leadId?: string;
    }> = [];

    for (const entry of entries) {
      const changes = entry.changes || [];

      for (const change of changes) {
        // Meta pode enviar field como "leadgen" ou "leadgen_id"
        if (change.field !== 'leadgen_id' && change.field !== 'leadgen') continue;

        const leadData = change.value;
        if (!leadData) continue;

        const leadgenId = String(leadData.leadgen_id || 'unknown');
        let fieldData = leadData.field_data || [];
        const adName = leadData.ad_name || 'Anúncio Meta Ads';
        const campaignName = leadData.campaign_name || '';
        const formName = leadData.form_name || '';

        // O Meta envia apenas o ID — buscar dados via Graph API
        if (fieldData.length === 0 && config.pageAccessToken) {
          console.log(`[Meta Webhook] field_data vazio para lead ${leadgenId} — buscando via Graph API`);
          const fetched = await fetchLeadData(leadgenId, config.pageAccessToken);
          if (fetched) {
            fieldData = fetched;
          } else {
            console.error(`[Meta Webhook] Não foi possível obter dados do lead ${leadgenId}. Verifique o Page Access Token.`);
          }
        } else if (fieldData.length === 0) {
          console.error(`[Meta Webhook] field_data vazio E sem Page Access Token. Lead ${leadgenId} será criado com dados mínimos.`);
        }

        // Extrair campos do formulário
        const rawName = getFieldValue(fieldData, 'full_name')
          || getFieldValue(fieldData, 'name')
          || getFieldValue(fieldData, 'nome')
          || getFieldValue(fieldData, 'nome_completo')
          || 'Lead Meta Ads';

        const rawEmail = getFieldValue(fieldData, 'email')
          || getFieldValue(fieldData, 'e_mail')
          || null;

        const rawPhone = getFieldValue(fieldData, 'phone_number')
          || getFieldValue(fieldData, 'phone')
          || getFieldValue(fieldData, 'celular')
          || getFieldValue(fieldData, 'telefone')
          || null;

        const city = getFieldValue(fieldData, 'city')
          || getFieldValue(fieldData, 'cidade')
          || null;

        // Formatar dados
        const name = rawName?.trim() || 'Lead Meta Ads';
        const email = rawEmail?.trim() || null;
        const phone = formatPhone(rawPhone);
        const region = city?.trim() || null;

        // 5. Verificar duplicata
        const existing = await findExistingClient(phone, email);
        if (existing) {
          console.log(`[Meta Webhook] Lead duplicado ignorado: ${name} (já existe cliente ${existing.id})`);

          // Criar interação registrando o novo contato do anúncio
          await db.interaction.create({
            data: {
              clientId: existing.id,
              description: `[Meta Ads] Novo lead recebido via anúncio "${adName}"${campaignName ? ` (campanha: ${campaignName})` : ''}. Formulário: ${formName}. Dados: ${email ? `Email: ${email}` : ''}${phone ? ` | Telefone: ${phone}` : ''}${region ? ` | Cidade: ${region}` : ''}. Lead ID: ${leadgenId}`,
            },
          });

          // Atualizar lastInteractionAt
          await db.client.update({
            where: { id: existing.id },
            data: { lastInteractionAt: new Date() },
          });

          results.push({
            success: true,
            clientName: existing.name,
            reason: 'duplicate_added_interaction',
            leadId: leadgenId,
          });
          continue;
        }

        // 6. Buscar o primeiro usuário admin para atribuir createdBy
        let creatorId: string | undefined;
        try {
          const admin = await db.user.findFirst({
            where: { role: 'ADMIN' },
            orderBy: { createdAt: 'asc' },
          });
          creatorId = admin?.id;
        } catch {}

        // 7. Criar o cliente
        try {
          const newClient = await db.client.create({
            data: {
              name,
              email: email || undefined,
              phone: phone || undefined,
              region: region || undefined,
              stage: 'LEAD',
              updatePeriod: 1, // Lead novo — acompanhar diariamente
              createdBy: creatorId || 'system',
              notes: `[Meta Ads] Lead recebido automaticamente.\nAnúncio: ${adName}${campaignName ? `\nCampanha: ${campaignName}` : ''}\nFormulário: ${formName}\nLead ID: ${leadgenId}`,
            },
          });

          // Criar interação inicial
          await db.interaction.create({
            data: {
              clientId: newClient.id,
              description: `[Meta Ads] Cliente criado automaticamente via lead do anúncio "${adName}"${campaignName ? ` (campanha: ${campaignName})` : ''}. Origem: Facebook/Instagram Lead Ads.`,
            },
          });

          console.log(`[Meta Webhook] Novo cliente criado: ${name} (ID: ${newClient.id})`);
          results.push({
            success: true,
            clientName: name,
            leadId: leadgenId,
          });
        } catch (createError) {
          console.error(`[Meta Webhook] Erro ao criar cliente ${name}:`, createError);
          results.push({
            success: false,
            clientName: name,
            reason: 'create_failed',
            leadId: leadgenId,
          });
        }
      }
    }

    // 8. Incrementar contador de leads recebidos
    const successCount = results.filter((r) => r.success).length;
    if (successCount > 0) {
      try {
        const currentSetting = await db.userSettings.findUnique({
          where: { key: 'meta_lead_count' },
        });
        const currentCount = parseInt(currentSetting?.value || '0', 10);
        await db.userSettings.upsert({
          where: { key: 'meta_lead_count' },
          update: { value: String(currentCount + successCount) },
          create: { key: 'meta_lead_count', value: String(successCount) },
        });
      } catch (countError) {
        console.warn('[Meta Webhook] Erro ao incrementar contador (não crítico):', countError);
      }
    }

    return NextResponse.json({
      received: true,
      processed: true,
      results,
      total: results.length,
      succeeded: results.filter((r) => r.success).length,
    });
  } catch (error) {
    console.error('[Meta Webhook] Erro interno:', error);
    return NextResponse.json(
      { error: 'Erro interno do servidor' },
      { status: 500 }
    );
  }
}