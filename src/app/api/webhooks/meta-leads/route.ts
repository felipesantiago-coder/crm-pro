import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import crypto from 'crypto';
import { notifyNewLead, notifyQueueUpdate } from '@/lib/telegram';
import { assignLeadToUser, peekNextUser } from '@/lib/lead-queue';
import { findCapConfigByFormId } from '@/lib/meta-conversions';
import { getMetaFieldValue, formatMetaPhone, extractCustomAnswers, formatCustomAnswersText } from '@/lib/meta-lead-utils';

export const maxDuration = 30;

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

// getFieldValue e formatPhone agora vêm de @/lib/meta-lead-utils
// (importados como getMetaFieldValue e formatMetaPhone)

/**
 * Busca os dados completos do lead via Graph API.
 * O webhook do Meta envia apenas o leadgen_id,
 * sem os field_data. Precisamos chamar a API para obter
 * nome, email, telefone, etc.
 */
async function fetchLeadData(leadgenId: string, pageAccessToken: string): Promise<Array<{ name: string; values: string[] }> | null> {
  try {
    const url = `https://graph.facebook.com/v22.0/${leadgenId}?access_token=${encodeURIComponent(pageAccessToken)}&fields=field_data`;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Meta Webhook] fetchLeadData(${leadgenId}) HTTP ${response.status}: ${errorText.slice(0, 300)}`);
      return null;
    }

    const data = await response.json();
    const fieldData = data?.field_data;

    if (!fieldData || !Array.isArray(fieldData)) {
      console.warn(`[Meta Webhook] fetchLeadData(${leadgenId}) — field_data ausente na resposta`);
      return null;
    }

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
  const conditions: Array<{ phone: string } | { email: string }> = [];

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

  const reqId = crypto.randomBytes(4).toString('hex');
  console.log(`[Meta Webhook][${reqId}] GET recebido — mode=${mode}, token=${token ? '***' + token.slice(-6) : 'null'}, challenge=${challenge ? 'present' : 'null'}, IP=${request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'}`);

  // Verificação padrão do Meta
  if (mode === 'subscribe' && token && challenge) {
    const config = await getMetaConfig();

    if (!config.verifyToken) {
      console.error(`[Meta Webhook][${reqId}] GET rejeitado — verifyToken não configurado`);
      return NextResponse.json(
        { error: 'Forbidden' },
        { status: 403 }
      );
    }

    if (token === config.verifyToken) {
      console.log(`[Meta Webhook][${reqId}] GET hub.challenge VERIFICADO com sucesso — Meta está assinando o webhook`);
      return new NextResponse(challenge, {
        status: 200,
        headers: { 'Content-Type': 'text/plain' },
      });
    }

    console.warn(`[Meta Webhook][${reqId}] GET rejeitado — token inválido (esperado ***${config.verifyToken.slice(-6)}, recebido ***${token.slice(-6)})`);
    return NextResponse.json({ error: 'Token inválido' }, { status: 403 });
  }

  // Non-verification GET — log e return generic response
  console.log(`[Meta Webhook][${reqId}] GET não é verificação — retornando status ok`);
  return NextResponse.json({ status: 'ok' });
}

// ============================================================
// POST — Recebimento de Lead
// O Meta envia esta requisição quando alguém preenche um
// formulário de lead em um anúncio.
// ============================================================
export async function POST(request: NextRequest) {
  const reqId = crypto.randomBytes(4).toString('hex');
  const startTime = Date.now();
  console.log(`[Meta Webhook][${reqId}] POST recebido — method=${request.method}, contentType=${request.headers.get('content-type')}, IP=${request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown'}, UA=${request.headers.get('user-agent') || 'unknown'}`);

  try {
    // 0. Ler o body UMA VEZ (necessário para validação HMAC)
    const rawBody = await request.text();
    const signature = request.headers.get('x-hub-signature-256');

    // 1. Verificar se o webhook está ativado
    const config = await getMetaConfig();
  console.log(`[Meta Webhook][${reqId}] Config: enabled=${config.enabled}, hasAppSecret=${!!config.appSecret}, hasPageAccessToken=${!!config.pageAccessToken}, hasVerifyToken=${!!config.verifyToken}, bodyLen=${rawBody.length}`);

    if (!config.enabled) {
      // WEBHOOK DESABILITADO — Salvar o lead perdido ANTES de rejeitar
      console.error('[Meta Webhook] ⚠ WEBHOOK DESABILITADO — Salvando lead perdido para recuperação futura');
      try {
        // Extrair leadgen_ids do payload para referência futura
        let parsedPayload: any = {};
        try { parsedPayload = JSON.parse(rawBody); } catch {}
        const leadgenIds = (parsedPayload?.entry || [])
          .flatMap((e: any) => (e.changes || []).map((c: any) => String(c.value?.leadgen_id || '')))
          .filter(Boolean);

        await db.lostLead.create({
          data: {
            source: 'meta_webhook_disabled',
            name: `Webhook desabilitado — ${leadgenIds.length} lead(s): ${leadgenIds.join(', ')}`,
            formData: {
              reason: 'webhook_disabled',
              leadgenIds,
              rawPayloadPreview: rawBody.slice(0, 3000),
              timestamp: new Date().toISOString(),
            },
          },
        });
        console.warn(`[Meta Webhook] ⚠ Lead perdido salvo na tabela lostLeads (razão: webhook_disabled, leadgenIds: [${leadgenIds.join(', ')}])`);
      } catch (saveErr) {
        console.error('[Meta Webhook] ⚠ CRÍTICO: Webhook desabilitado E falha ao salvar lead perdido:', saveErr);
      }
      // Retorna 200 (não 503!) para que o Meta NÃO retenta —
      // o lead foi salvo para recuperação manual pelo admin.
      return NextResponse.json(
        { received: true, processed: false, reason: 'webhook_disabled', saved_for_recovery: true },
        { status: 200 }
      );
    }

    // 2. Validar assinatura HMAC
    if (!config.appSecret) {
      console.error('[Meta Webhook] ⚠ APP_SECRET não configurado — impossível validar assinatura. Configure meta_app_secret nas configurações.');
      return NextResponse.json({ error: 'App Secret não configurado' }, { status: 403 });
    }

    if (!isValidSignature(rawBody, signature, config.appSecret)) {
      // ASSINATURA INVÁLIDA — Log detalhado + salvar payload para diagnóstico
      console.error(`[Meta Webhook] ⚠ ASSINATURA INVÁLIDA — header=${signature?.slice(0, 20)}... bodyLen=${rawBody.length}. Verifique se o App Secret está correto.`);
      try {
        let parsedPayload: any = {};
        try { parsedPayload = JSON.parse(rawBody); } catch {}
        const leadgenIds = (parsedPayload?.entry || [])
          .flatMap((e: any) => (e.changes || []).map((c: any) => String(c.value?.leadgen_id || '')))
          .filter(Boolean);

        await db.lostLead.create({
          data: {
            source: 'meta_webhook_invalid_signature',
            name: `Assinatura inválida — ${leadgenIds.length} lead(s): ${leadgenIds.join(', ')}`,
            formData: {
              reason: 'invalid_signature',
              leadgenIds,
              signatureHeader: signature?.slice(0, 30) || 'missing',
              bodyLength: rawBody.length,
              rawPayloadPreview: rawBody.slice(0, 3000),
              timestamp: new Date().toISOString(),
            },
          },
        });
      } catch {}
      return NextResponse.json({ error: 'Assinatura inválida' }, { status: 401 });
    }

    // 3. Parsear o payload
    let body: {
      object?: string;
      entry?: Array<{
        id?: string;
        changes?: Array<{
          field: string;
          value?: {
            leadgen_id?: string | number;
            field_data?: Array<{ name: string; values: string[] }>;
            ad_name?: string;
            ad_id?: string;
            campaign_name?: string;
            campaign_id?: string;
            form_name?: string;
            form_id?: string;
          };
        }>;
      }>;
    };
    try {
      body = JSON.parse(rawBody);
    } catch {
      console.error(`[Meta Webhook] ⚠ Payload JSON inválido (primeiros 200 chars): ${rawBody.slice(0, 200)}`);
      return NextResponse.json({ error: 'JSON inválido' }, { status: 400 });
    }

    // 4. Extrair dados do lead do payload
    const entries = body.entry || [];

    // Log estrutural do payload (sem PII)
    const allFields = entries.flatMap(e => (e.changes || []).map(c => c.field));
    console.log(`[Meta Webhook] Payload: object=${body.object}, entries=${entries.length}, fields=[${allFields.join(', ')}]`);

    if (entries.length === 0) {
      console.warn('[Meta Webhook] ⚠ Entries vazio no payload — nenhum lead para processar');
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
        const leadData = change.value;

        // Log cada change para identificar field inesperados
        const changeLeadgenId = leadData?.leadgen_id;
        console.log(`[Meta Webhook] Change: field="${change.field}", leadgen_id=${changeLeadgenId ?? 'none'}, ad=${leadData?.ad_name || 'none'}, campaign=${leadData?.campaign_name || 'none'}`);

        // Meta pode enviar field como "leadgen", "leadgen_id", ou conter o leadgen_id
        // no value mesmo com field diferente (ex: versões antigas da API).
        // CRÍTICO: Só ignorar se NÃO houver leadgen_id no value.
        if (!leadData || !leadData.leadgen_id) {
          console.warn(`[Meta Webhook] ⚠ Change field="${change.field}" sem leadgen_id no value — ignorado`);
          continue;
        }

        const leadgenId = String(leadData.leadgen_id || 'unknown');
        let fieldData = leadData.field_data || [];
        const adName = leadData.ad_name || 'Anúncio Meta Ads';
        const campaignName = leadData.campaign_name || '';
        const formName = leadData.form_name || '';
        const formId = leadData.form_id || '';
        const adId = String(leadData.ad_id || '');
        const campaignId = String(leadData.campaign_id || '');

        console.log(`[Meta Webhook] Processando leadgen_id=${leadgenId}, formId=${formId}, ad="${adName}", campaign="${campaignName}"`);

        // Auto-populate lead_form_mappings (fire-and-forget, non-critical)
        if (formId) {
          db.leadFormMapping.upsert({
            where: { formId_campaignId: { formId, campaignId: campaignId || '__no_campaign' } },
            create: {
              formId,
              formName: formName || null,
              adId: adId || null,
              adName: adName !== 'Anúncio Meta Ads' ? adName : null,
              campaignId: campaignId || null,
              campaignName: campaignName || null,
            },
            update: {
              leadCount: { increment: 1 },
              formName: formName || undefined,
              adName: adName !== 'Anúncio Meta Ads' ? adName : undefined,
            },
          }).catch((err: any) => {
            console.warn(`[Meta Webhook] Falha ao upsert form mapping ${formId}:`, err?.message || err);
          });
        }

        // Buscar CAPI config por form_id (para multi-client CAPI)
        let capiConfigId: string | undefined;
        if (formId) {
          try {
            const capiMatch = await findCapConfigByFormId(formId);
            if (capiMatch) {
              capiConfigId = capiMatch.id;
            }
          } catch (capiErr) {
            console.warn(`[Meta Webhook] Falha ao buscar CAPI config para form ${formId}:`, capiErr);
          }
        }

        // O Meta envia apenas o ID — buscar dados via Graph API
        if (fieldData.length === 0 && config.pageAccessToken) {
          console.log(`[Meta Webhook] Buscando dados do lead ${leadgenId} via Graph API (field_data vazio no webhook)`);
          const fetched = await fetchLeadData(leadgenId, config.pageAccessToken);
          if (fetched) {
            fieldData = fetched;
          } else {
            console.error(`[Meta Webhook] ⚠ Não foi possível buscar dados do lead ${leadgenId} via Graph API — lead será criado com dados mínimos`);
          }
        } else if (fieldData.length === 0) {
          console.error(`[Meta Webhook] ⚠ Sem field_data e sem pageAccessToken para lead ${leadgenId} — lead será criado com dados mínimos`);
        } else {
          console.log(`[Meta Webhook] field_data presente no webhook com ${fieldData.length} campos para lead ${leadgenId}`);
        }

        // Extrair campos do formulário
        const rawName = getMetaFieldValue(fieldData, 'full_name')
          || getMetaFieldValue(fieldData, 'name')
          || getMetaFieldValue(fieldData, 'nome')
          || getMetaFieldValue(fieldData, 'nome_completo')
          || 'Lead Meta Ads';

        const rawEmail = getMetaFieldValue(fieldData, 'email')
          || getMetaFieldValue(fieldData, 'e_mail')
          || null;

        const rawPhone = getMetaFieldValue(fieldData, 'phone_number')
          || getMetaFieldValue(fieldData, 'phone')
          || getMetaFieldValue(fieldData, 'celular')
          || getMetaFieldValue(fieldData, 'telefone')
          || null;

        const city = getMetaFieldValue(fieldData, 'city')
          || getMetaFieldValue(fieldData, 'cidade')
          || null;

        // Formatar dados
        const name = rawName?.trim() || 'Lead Meta Ads';
        const email = rawEmail?.trim() || null;
        const phone = formatMetaPhone(rawPhone);
        const region = city?.trim() || null;

        // Extrair respostas customizadas (perguntas extras do formulário)
        const customAnswers = extractCustomAnswers(fieldData);
        const customAnswersText = formatCustomAnswersText(customAnswers);

        console.log(`[Meta Webhook] Dados extraídos: name="${name}", email=${email || 'null'}, phone=${phone || 'null'}, city=${region || 'null'}`);

        // 5. Verificar duplicata por telefone/email
        const existing = await findExistingClient(phone, email);
        let assignedUserName: string | undefined;
        if (existing) {
          console.log(`[Meta Webhook] Cliente existente encontrado: id=${existing.id}, name="${existing.name}" — criando interação`);

          // Criar interação registrando o novo contato do anúncio
          await db.interaction.create({
            data: {
              clientId: existing.id,
              description: `[Meta Ads] Novo lead recebido via anúncio "${adName}"${campaignName ? ` (campanha: ${campaignName})` : ''}. Formulário: ${formName}. Dados: ${email ? `Email: ${email}` : ''}${phone ? ` | Telefone: ${phone}` : ''}${region ? ` | Cidade: ${region}` : ''}. Lead ID: ${leadgenId}${customAnswersText}`,
            },
          });

          // FIX: Also update phone if new one provided
          if (phone) {
            await db.client.update({
              where: { id: existing.id },
              data: { lastInteractionAt: new Date(), ...(phone !== existing.phone ? { phone } : {}) },
            }).catch(() => {});
          } else {
            await db.client.update({
              where: { id: existing.id },
              data: { lastInteractionAt: new Date() },
            }).catch(() => {});
          }

          // Assign via queue even for existing clients
          try {
            const assignResult = await assignLeadToUser({
              leadId: existing.id,
              source: `meta_ads:${(campaignName || adName || '').slice(0, 200)}`,
            });
            if (assignResult.assigned && assignResult.userId) {
              assignedUserName = assignResult.userName;
              console.log(`[Meta Webhook] Fila: lead existente ${existing.id} atribuído a "${assignResult.userName}"`);
              await db.client.update({
                where: { id: existing.id },
                data: { createdBy: assignResult.userId },
              }).catch(() => {});
              // Send Telegram notification to assigned agent (await — serverless-safe)
              try {
                const agentUser = await db.user.findUnique({ where: { id: assignResult.userId }, select: { telegramChatId: true, name: true } });
                if (agentUser?.telegramChatId) {
                  console.log(`[Meta Webhook][${reqId}] Enviando notificação Telegram para agente "${agentUser.name}" (lead existente ${existing.id})`);
                  await notifyNewLead(agentUser.telegramChatId, {
                    leadName: existing.name,
                    leadPhone: phone || existing.phone || '',
                    leadEmail: email || existing.email || '',
                    enterpriseName: undefined,
                    utmCampaign: campaignName || null,
                    utmSource: 'meta_ads',
                    slug: undefined,
                    assignedUserName: assignResult.userName,
                    customAnswers,
                  });
                  console.log(`[Meta Webhook][${reqId}] ✅ Notificação Telegram enviada ao agente "${agentUser.name}"`);
                } else {
                  console.warn(`[Meta Webhook][${reqId}] Usuário ${agentUser?.name || assignResult.userId} sem Telegram configurado. Lead existente ${existing.id} sem notificação.`);
                }
              } catch (notifyErr) {
                console.warn(`[Meta Webhook][${reqId}] Falha na notificação do agente (lead existente):`, notifyErr);
              }

              // Notify admin about queue rotation (await — serverless-safe)
              if (assignResult.message !== 'already_assigned') {
                try {
                  const admin = await db.user.findFirst({ where: { role: 'ADMIN' }, select: { telegramChatId: true } });
                  if (admin?.telegramChatId) {
                    const nextUser = await peekNextUser({ queueId: assignResult.queueId });
                    console.log(`[Meta Webhook][${reqId}] Enviando notificação de fila ao admin`);
                    await notifyQueueUpdate(admin.telegramChatId, {
                      source: `meta_ads:${(campaignName || adName || '').slice(0, 200)}`,
                      assignedUserName: assignResult.userName || 'Desconhecido',
                      nextUserName: nextUser?.userName || null,
                      leadName: existing.name,
                      leadPhone: existing.phone || phone || undefined,
                    });
                    console.log(`[Meta Webhook][${reqId}] ✅ Notificação de fila enviada ao admin`);
                  } else {
                    console.warn(`[Meta Webhook][${reqId}] Admin sem Telegram configurado — notificação de fila pulada`);
                  }
                } catch (err) {
                  console.warn(`[Meta Webhook][${reqId}] Admin queue notification failed (existing):`, err instanceof Error ? err.message : err);
                }
              }
            } else {
              console.warn(`[Meta Webhook] ⚠ Fila: não foi possível atribuir lead existente ${existing.id}: ${assignResult.message}`);
            }
          } catch (queueErr) {
            console.error(`[Meta Webhook] ⚠ Falha na atribuição de fila (lead existente ${existing.id}):`, queueErr);
          }

          results.push({
            success: true,
            clientName: existing.name,
            reason: 'duplicate_added_interaction',
            leadId: leadgenId,
          });
          continue;
        }

        // 5b. Check for duplicate — dedicated metaLeadgenId column (O(1) indexed lookup)
        try {
          const existingByLeadgenId = await db.client.findUnique({
            where: { metaLeadgenId: leadgenId },
            select: { id: true },
          });
          if (existingByLeadgenId) {
            console.log(`[Meta Webhook] Lead ${leadgenId} já processado anteriormente (client ${existingByLeadgenId.id}) — ignorando`);
            results.push({ success: true, clientName: 'dedup', reason: 'already_processed', leadId: leadgenId });
            continue;
          }
        } catch (dedupErr) {
          console.warn(`[Meta Webhook] Falha na verificação de duplicata para lead ${leadgenId}:`, dedupErr);
        }

        // 6. Find a user for createdBy (required FK)
        let creatorId: string | undefined;
        try {
          const admin = await db.user.findFirst({
            where: { role: 'ADMIN' },
            select: { id: true },
            orderBy: { createdAt: 'asc' },
          });
          creatorId = admin?.id;
          if (!creatorId) {
            const anyUser = await db.user.findFirst({ select: { id: true }, orderBy: { createdAt: 'asc' } });
            creatorId = anyUser?.id;
          }
          if (!creatorId) {
            console.error(`[Meta Webhook] ⚠ NENHUM USUÁRIO NO SISTEMA — Lead "${name}" (${leadgenId}) PERDIDO!`);
            results.push({ success: false, clientName: name, reason: 'no_user', leadId: leadgenId });
            continue;
          }
        } catch {
          console.error('[Meta Webhook] ⚠ Erro ao buscar usuário para createdBy');
          results.push({ success: false, clientName: name, reason: 'no_user', leadId: leadgenId });
          continue;
        }

        // 7. Create client FIRST (before queue assignment)
        try {
          const newClient = await db.client.create({
            data: {
              name,
              email: email || undefined,
              phone: phone || undefined,
              region: region || undefined,
              stage: 'LEAD',
              updatePeriod: 1,
              createdBy: creatorId,
              metaLeadgenId: leadgenId,
              metaCapConfigId: capiConfigId,
              notes: `[Meta Ads] Lead recebido automaticamente.\nAnúncio: ${adName}${campaignName ? `\nCampanha: ${campaignName}` : ''}\nFormulário: ${formName}${formId ? ` (ID: ${formId})` : ''}\nLead ID: ${leadgenId}${capiConfigId ? `\nCAPI Config: ${capiConfigId}` : ''}${customAnswersText}`,
            },
          });
          console.log(`[Meta Webhook] ✅ Cliente criado: id=${newClient.id}, name="${name}", phone=${phone || 'null'}, email=${email || 'null'}`);

          // Create initial interaction
          await db.interaction.create({
            data: {
              clientId: newClient.id,
              description: `[Meta Ads] Cliente criado automaticamente via lead do anúncio "${adName}"${campaignName ? ` (campanha: ${campaignName})` : ''}. Origem: Facebook/Instagram Lead Ads.${customAnswersText}`,
            },
          });

          // 8. Assign via queue (direct function call, NOT HTTP)
          let assignedUserId: string | undefined;
          let assignedQueueId: string | undefined;
          try {
            const assignResult = await assignLeadToUser({
              leadId: newClient.id,
              source: `meta_ads:${(campaignName || adName || '').slice(0, 200)}`,
            });
            if (assignResult.assigned && assignResult.userId) {
              assignedUserId = assignResult.userId;
              assignedQueueId = assignResult.queueId;
              assignedUserName = assignResult.userName;
              console.log(`[Meta Webhook] ✅ Fila: client ${newClient.id} atribuído a "${assignResult.userName}" (userId=${assignResult.userId})`);
              await db.client.update({
                where: { id: newClient.id },
                data: {
                  createdBy: assignedUserId,
                  utmSource: 'meta_ads',
                  utmCampaign: (campaignName || '').slice(0, 200) || undefined,
                },
              }).catch(() => {});
            } else {
              console.warn(`[Meta Webhook] ⚠ Fila: não foi possível atribuir client ${newClient.id}: ${assignResult.message}`);
            }
          } catch (queueErr) {
            console.error(`[Meta Webhook] ⚠ Falha na atribuição de fila (client ${newClient.id}):`, queueErr);
          }

          // 9. Send Telegram notification to assigned agent (await — serverless-safe)
          const notifyId = assignedUserId || creatorId;
          if (notifyId) {
            try {
              const agentUser = await db.user.findUnique({ where: { id: notifyId }, select: { telegramChatId: true, name: true } });
              if (agentUser?.telegramChatId) {
                console.log(`[Meta Webhook][${reqId}] Enviando notificação Telegram para agente "${agentUser.name}" (client ${newClient.id})`);
                await notifyNewLead(agentUser.telegramChatId, {
                  leadName: newClient.name,
                  leadPhone: newClient.phone || '',
                  leadEmail: newClient.email || '',
                  enterpriseName: undefined,
                  utmCampaign: campaignName || null,
                  utmSource: 'meta_ads',
                  slug: undefined,
                  assignedUserName: assignedUserName,
                  customAnswers,
                });
                console.log(`[Meta Webhook][${reqId}] ✅ Notificação Telegram enviada ao agente "${agentUser.name}"`);
              } else {
                console.warn(`[Meta Webhook][${reqId}] Usuário ${agentUser?.name || notifyId} atribuído mas sem Telegram. Lead ${newClient.id} (${name}) sem notificação.`);
              }
            } catch (notifyErr) {
              console.warn(`[Meta Webhook][${reqId}] Falha na notificação do agente (client ${newClient.id}):`, notifyErr);
            }
          }

          // 10. Notify admin about queue rotation (await — serverless-safe)
          if (assignedUserId && assignedQueueId) {
            try {
              const admin = await db.user.findFirst({ where: { role: 'ADMIN' }, select: { telegramChatId: true } });
              if (admin?.telegramChatId) {
                const nextUser = await peekNextUser({ queueId: assignedQueueId });
                console.log(`[Meta Webhook][${reqId}] Enviando notificação de fila ao admin`);
                await notifyQueueUpdate(admin.telegramChatId, {
                  source: `meta_ads:${(campaignName || adName || '').slice(0, 200)}`,
                  assignedUserName: assignedUserName || 'Desconhecido',
                  nextUserName: nextUser?.userName || null,
                  leadName: newClient.name,
                  leadPhone: newClient.phone || undefined,
                });
                console.log(`[Meta Webhook][${reqId}] ✅ Notificação de fila enviada ao admin`);
              } else {
                console.warn(`[Meta Webhook][${reqId}] Admin sem Telegram configurado — notificação de fila pulada`);
              }
            } catch (err) {
              console.warn(`[Meta Webhook][${reqId}] Admin queue notification failed (new):`, err instanceof Error ? err.message : err);
            }
          }

          results.push({ success: true, clientName: name, leadId: leadgenId });
        } catch (createError) {
          console.error(`[Meta Webhook] ⚠ Erro ao criar cliente "${name}" (${leadgenId}):`, createError);
          results.push({ success: false, clientName: name, reason: 'create_failed', leadId: leadgenId });
        }
      }
    }

    // Log resumo final
    const successCount = results.filter((r) => r.success).length;
    const failedResults = results.filter((r) => !r.success);
    const elapsed = Date.now() - startTime;
    console.log(`[Meta Webhook][${reqId}] Resumo: ${successCount}/${results.length} processados com sucesso em ${elapsed}ms${failedResults.length > 0 ? `. Falhas: ${failedResults.map(r => `${r.reason}(${r.leadId})`).join(', ')}` : ''}`);

    // Incrementar contador de leads recebidos
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
        // Non-critical: counter update failed silently
      }
    }

    return NextResponse.json({
      received: true,
      processed: true,
      results,
      total: results.length,
      succeeded: successCount,
    });
  } catch (error) {
    console.error('[Meta Webhook] ⚠ ERRO INTERNO:', error);
    return NextResponse.json(
      { error: 'Erro interno do servidor' },
      { status: 500 }
    );
  }
}
