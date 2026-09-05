import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/api-auth';
import { fetchEnabledAdAccounts } from '@/lib/meta-ad-accounts';
import { notifyNewLead, notifyQueueUpdate } from '@/lib/telegram';
import { assignLeadToUser, peekNextUser } from '@/lib/lead-queue';
import { findCapConfigByFormId } from '@/lib/meta-conversions';
import { getMetaFieldValue, formatMetaPhone, extractCustomAnswers, formatCustomAnswersText } from '@/lib/meta-lead-utils';

// ============================================================
// POST /api/webhooks/meta-leads/import-manual
// Importa leads perdidos manualmente via leadgen_id.
// Usa o Page Access Token (não precisa de ads_read).
//
// Body: { leadgenIds: string[] }
//
// ORDEM CRONOLÓGICA: Os leads são buscados da Meta em paralelo,
// ordenados por created_time (mais antigo primeiro) e só então
// processados. Isso garante que a fila round-robin distribua
// os leads na ordem real em que foram cadastrados no Meta.
// ============================================================

interface LeadgenData {
  field_data: Array<{ name: string; values: string[] }>;
  ad_id?: string;
  campaign_id?: string;
  form_id?: string;
  created_time?: string;
}

async function fetchLeadFromMeta(leadgenId: string, pageAccessToken: string): Promise<LeadgenData | null> {
  const url = `https://graph.facebook.com/v22.0/${leadgenId}?access_token=${encodeURIComponent(pageAccessToken)}&fields=field_data,ad_id,campaign_id,form_id,created_time`;
  const response = await fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`[Import Manual] Falha ao buscar lead ${leadgenId}: HTTP ${response.status} — ${errorText.slice(0, 300)}`);
    return null;
  }

  const data = await response.json();
  if (!data?.field_data || !Array.isArray(data.field_data)) {
    console.warn(`[Import Manual] lead ${leadgenId} sem field_data`);
    return null;
  }

  return data as LeadgenData;
}

export async function POST(request: NextRequest) {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    const body = await request.json();
    const { leadgenIds, accountId } = body as { leadgenIds?: string[]; accountId?: string };

    if (!leadgenIds || !Array.isArray(leadgenIds) || leadgenIds.length === 0) {
      return NextResponse.json({ error: 'Envie um array leadgenIds' }, { status: 400 });
    }

    if (leadgenIds.length > 50) {
      return NextResponse.json({ error: 'Máximo de 50 leads por requisição' }, { status: 400 });
    }

    // Tokens nas CONTAS de anúncios (configuração EXCLUSIVAMENTE por
    // conta — não existe mais token global). accountId = preferência;
    // sem preferência, tenta o token de cada conta até obter sucesso.
    const accounts = await fetchEnabledAdAccounts('all');
    if (accounts.length === 0) {
      return NextResponse.json({ error: 'Nenhuma conta de anúncios configurada. Cadastre em Anúncios Meta > Contas de Anúncio com o access token dela.' }, { status: 400 });
    }
    const preferredAccount = accountId ? accounts.find(a => a.id === accountId) : undefined;
    if (accountId && !preferredAccount) {
      return NextResponse.json({ error: 'Conta de anúncios não encontrada ou inativa' }, { status: 404 });
    }
    const tokenCandidates = [
      ...(preferredAccount?.accessToken ? [preferredAccount.accessToken] : []),
      ...accounts.filter(a => a.id !== preferredAccount?.id && a.accessToken).map(a => a.accessToken),
    ];

    // Buscar um admin para createdBy
    const admin = await db.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true }, orderBy: { createdAt: 'asc' } });
    let creatorId = admin?.id;
    if (!creatorId) {
      const anyUser = await db.user.findFirst({ select: { id: true }, orderBy: { createdAt: 'asc' } });
      creatorId = anyUser?.id;
    }
    if (!creatorId) {
      return NextResponse.json({ error: 'Nenhum usuário cadastrado no sistema' }, { status: 400 });
    }

    // ══════════════════════════════════════════════════════════
    // FASE 1: Buscar todos os leads da Meta em paralelo
    // ══════════════════════════════════════════════════════════
    console.log(`[Import Manual] Fase 1: Buscando ${leadgenIds.length} leads da Meta em paralelo...`);

    interface FetchedLead {
      leadgenId: string;
      data: LeadgenData;
    }

    const validIds = leadgenIds.map(id => String(id).trim()).filter(Boolean);
    const fetchPromises = validIds.map(async (leadgenId) => {
      for (const token of tokenCandidates) {
        const data = await fetchLeadFromMeta(leadgenId, token);
        if (data) return data ? { leadgenId, data } as FetchedLead : null;
      }
      return null;
    });

    const fetchResults = await Promise.allSettled(fetchPromises);
    const fetchedLeads: FetchedLead[] = [];
    const results: Array<{
      leadgenId: string;
      success: boolean;
      clientName?: string;
      clientId?: string;
      reason?: string;
      assignedTo?: string;
    }> = [];

    for (let i = 0; i < fetchResults.length; i++) {
      const leadgenId = validIds[i];
      const fetchResult = fetchResults[i];
      if (fetchResult.status === 'fulfilled' && fetchResult.value) {
        fetchedLeads.push(fetchResult.value);
      } else {
        const errMsg = fetchResult.status === 'rejected'
          ? (fetchResult.reason?.message || 'erro desconhecido')
          : 'Não foi possível buscar dados do lead na Meta';
        results.push({
          leadgenId,
          success: false,
          reason: `${errMsg}. Verifique se o Page Access Token está correto e se o leadgen_id é válido.`,
        });
      }
    }

    // ══════════════════════════════════════════════════════════
    // FASE 2: Ordenar por created_time ASC (mais antigo primeiro)
    // A ordem em que o admin cola os IDs não é confiável — o Meta
    // Ads Manager mostra leads mais recentes primeiro. O created_time
    // do Meta é a fonte de verdade da ordem de cadastro.
    // ══════════════════════════════════════════════════════════
    fetchedLeads.sort((a, b) => {
      const timeA = a.data.created_time ? new Date(a.data.created_time).getTime() : 0;
      const timeB = b.data.created_time ? new Date(b.data.created_time).getTime() : 0;
      return timeA - timeB;
    });

    if (fetchedLeads.length > 0) {
      const first = fetchedLeads[0];
      const last = fetchedLeads[fetchedLeads.length - 1];
      console.log(`[Import Manual] Fase 2: ${fetchedLeads.length} leads buscados com sucesso. Ordenação cronológica: mais antigo=${first.leadgenId} (${first.data.created_time || 'sem data'}), mais recente=${last.leadgenId} (${last.data.created_time || 'sem data'})`);
    }

    // ══════════════════════════════════════════════════════════
    // FASE 3: Processar cada lead na ordem cronológica
    // ══════════════════════════════════════════════════════════
    for (const { leadgenId, data: leadData } of fetchedLeads) {
      console.log(`[Import Manual] Fase 3: Processando leadgen_id=${leadgenId} (${leadData.created_time || 'sem data'})`);

      // 1. Verificar se já foi processado
      try {
        const existing = await db.client.findUnique({ where: { metaLeadgenId: leadgenId }, select: { id: true, name: true } });
        if (existing) {
          results.push({ leadgenId, success: true, clientName: existing.name, clientId: existing.id, reason: 'já_existente' });
          console.log(`[Import Manual] Lead ${leadgenId} já existe (client ${existing.id})`);
          continue;
        }
      } catch (dedupErr) {
        console.warn(`[Import Manual] Falha na verificar duplicata para ${leadgenId}:`, dedupErr);
      }

      const fieldData = leadData.field_data;
      const formId = leadData.form_id || '';
      const campaignId = String(leadData.campaign_id || '');

      // 2. Extrair campos
      const rawName = getMetaFieldValue(fieldData, 'full_name')
        || getMetaFieldValue(fieldData, 'name')
        || getMetaFieldValue(fieldData, 'nome')
        || getMetaFieldValue(fieldData, 'nome_completo')
        || 'Lead Meta Ads (importado)';

      const rawEmail = getMetaFieldValue(fieldData, 'email') || getMetaFieldValue(fieldData, 'e_mail') || null;
      const rawPhone = getMetaFieldValue(fieldData, 'phone_number')
        || getMetaFieldValue(fieldData, 'phone')
        || getMetaFieldValue(fieldData, 'celular')
        || getMetaFieldValue(fieldData, 'telefone')
        || null;
      const city = getMetaFieldValue(fieldData, 'city') || getMetaFieldValue(fieldData, 'cidade') || null;

      const name = rawName?.trim() || 'Lead Meta Ads (importado)';
      const email = rawEmail?.trim() || null;
      const phone = formatMetaPhone(rawPhone);
      const region = city?.trim() || null;

      // Extrair respostas customizadas (perguntas extras do formulário)
      const customAnswers = extractCustomAnswers(fieldData);
      const customAnswersText = formatCustomAnswersText(customAnswers);

      // 3. Verificar duplicata por telefone/email
      const existingByContact = await db.client.findFirst({
        where: {
          OR: [
            ...(phone ? [{ phone }] : []),
            ...(email ? [{ email }] : []),
          ],
        },
        orderBy: { createdAt: 'desc' },
      });

      if (existingByContact) {
        // Atualizar metaLeadgenId no cliente existente para evitar re-import
        await db.client.update({
          where: { id: existingByContact.id },
          data: { metaLeadgenId: leadgenId, lastInteractionAt: new Date() },
        }).catch(() => {});

        // Criar interação com respostas do formulário
        await db.interaction.create({
          data: {
            clientId: existingByContact.id,
            description: `[Meta Ads] Lead ${leadgenId} importado manualmente. Dados: ${email ? `Email: ${email}` : ''}${phone ? ` | Telefone: ${phone}` : ''}${region ? ` | Cidade: ${region}` : ''}.${customAnswersText}`,
          },
        });

        // Tentar atribuir à fila
        let assignedTo: string | undefined;
        let assignedUserId: string | undefined;
        let assignedQueueId: string | undefined;
        try {
          const assignResult = await assignLeadToUser({ leadId: existingByContact.id, source: 'meta_ads:import_manual' });
          if (assignResult.assigned && assignResult.message !== 'already_assigned') {
            // New assignment — notify agent
            assignedTo = assignResult.userName;
            assignedUserId = assignResult.userId;
            assignedQueueId = assignResult.queueId;
            await db.client.update({ where: { id: existingByContact.id }, data: { createdBy: assignResult.userId! } }).catch(() => {});
            db.user.findUnique({ where: { id: assignResult.userId }, select: { telegramChatId: true, name: true } }).then((user) => {
              if (user?.telegramChatId) {
                notifyNewLead(user.telegramChatId, {
                  leadName: existingByContact.name,
                  leadPhone: phone || existingByContact.phone || '',
                  leadEmail: email || existingByContact.email || '',
                  enterpriseName: undefined,
                  utmCampaign: 'import_manual',
                  utmSource: 'meta_ads',
                  slug: undefined,
                  assignedUserName: assignResult.userName,
                  customAnswers,
                }).catch((err) => console.warn('[Import Manual] Falha na notificação (lead existente, nova atribuição):', err));
              }
            }).catch(() => {});
            // Notify admin
            if (assignResult.queueId) {
              const capturedQueueId = assignResult.queueId;
              const capturedUserName = assignResult.userName;
              (async () => {
                try {
                  const adminUser = await db.user.findFirst({ where: { role: 'ADMIN' }, select: { telegramChatId: true } });
                  if (!adminUser?.telegramChatId) return;
                  const nextUser = await peekNextUser({ queueId: capturedQueueId });
                  await notifyQueueUpdate(adminUser.telegramChatId, {
                    source: 'meta_ads:import_manual',
                    assignedUserName: capturedUserName || 'Desconhecido',
                    nextUserName: nextUser?.userName || null,
                    leadName: existingByContact.name,
                    leadPhone: phone || undefined,
                  });
                } catch (err) {
                  console.warn('[Import Manual] Admin queue notification failed (existing):', err instanceof Error ? err.message : err);
                }
              })();
            }
          } else if (assignResult.assigned) {
            // already_assigned — no notification needed, queue didn't advance
            assignedTo = assignResult.userName;
          }
        } catch {}

        results.push({ leadgenId, success: true, clientName: existingByContact.name, clientId: existingByContact.id, reason: 'cliente_existente_atualizado', assignedTo });
        console.log(`[Import Manual] Lead ${leadgenId} vinculado ao cliente existente ${existingByContact.id}`);
        continue;
      }

      // 4. Buscar CAPI config
      let capiConfigId: string | undefined;
      if (formId) {
        try {
          const capiMatch = await findCapConfigByFormId(formId);
          if (capiMatch) capiConfigId = capiMatch.id;
        } catch {}
      }

      // 5. Criar cliente
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
            notes: `[Meta Ads] Lead importado manualmente.\nLead ID: ${leadgenId}${formId ? `\nForm ID: ${formId}` : ''}${campaignId ? `\nCampaign ID: ${campaignId}` : ''}${leadData.created_time ? `\nCriado em: ${leadData.created_time}` : ''}${customAnswersText}`,
          },
        });

        await db.interaction.create({
          data: {
            clientId: newClient.id,
            description: `[Meta Ads] Lead importado manualmente via leadgen_id. Origem: Facebook/Instagram Lead Ads.${customAnswersText}`,
          },
        });

        // 6. Atribuir à fila
        let assignedTo: string | undefined;
        let assignedUserId: string | undefined;
        let assignedQueueId: string | undefined;
        try {
          const assignResult = await assignLeadToUser({ leadId: newClient.id, source: 'meta_ads:import_manual' });
          if (assignResult.assigned && assignResult.userId) {
            assignedTo = assignResult.userName;
            assignedUserId = assignResult.userId;
            assignedQueueId = assignResult.queueId;
            await db.client.update({
              where: { id: newClient.id },
              data: { createdBy: assignResult.userId, utmSource: 'meta_ads', utmCampaign: 'import_manual' },
            }).catch(() => {});
          }
        } catch (queueErr) {
          console.error(`[Import Manual] Falha na fila para ${newClient.id}:`, queueErr);
        }

        // 7. Notificação Telegram para o atendente
        const notifyId = assignedUserId || creatorId;
        if (notifyId) {
          db.user.findUnique({ where: { id: notifyId }, select: { telegramChatId: true, name: true } }).then((user) => {
            if (user?.telegramChatId) {
              notifyNewLead(user.telegramChatId, {
                leadName: newClient.name,
                leadPhone: newClient.phone || '',
                leadEmail: newClient.email || '',
                enterpriseName: undefined,
                utmCampaign: 'import_manual',
                utmSource: 'meta_ads',
                slug: undefined,
                assignedUserName: assignedTo,
                customAnswers,
              }).catch(() => {});
            }
          }).catch(() => {});
        }

        // 8. Notify admin about queue rotation (fire-and-forget)
        if (assignedUserId && assignedQueueId) {
          const capturedQueueId = assignedQueueId;
          const capturedUserName = assignedTo;
          (async () => {
            try {
              const adminUser = await db.user.findFirst({ where: { role: 'ADMIN' }, select: { telegramChatId: true } });
              if (!adminUser?.telegramChatId) return;
              const nextUser = await peekNextUser({ queueId: capturedQueueId });
              await notifyQueueUpdate(adminUser.telegramChatId, {
                source: 'meta_ads:import_manual',
                assignedUserName: capturedUserName || 'Desconhecido',
                nextUserName: nextUser?.userName || null,
                leadName: newClient.name,
                leadPhone: newClient.phone || undefined,
              });
            } catch (err) {
              console.warn('[Import Manual] Admin queue notification failed:', err instanceof Error ? err.message : err);
            }
          })();
        }

        results.push({ leadgenId, success: true, clientName: name, clientId: newClient.id, assignedTo });
        console.log(`[Import Manual] ✅ Lead ${leadgenId} importado como client ${newClient.id} (${name})`);
      } catch (createErr) {
        console.error(`[Import Manual] Erro ao criar cliente para lead ${leadgenId}:`, createErr);
        results.push({ leadgenId, success: false, clientName: name, reason: 'Erro ao criar cliente no banco' });
      }
    }

    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success);

    console.log(`[Import Manual] Resumo: ${succeeded}/${results.length} com sucesso (${fetchedLeads.length} buscados da Meta, ordenados por created_time ASC)`);

    return NextResponse.json({
      imported: succeeded,
      total: results.length,
      results,
      message: `${succeeded} lead${succeeded !== 1 ? 's' : ''} importado${succeeded !== 1 ? 's' : ''} com sucesso${failed.length > 0 ? `, ${failed.length} falha(s)` : ''}`,
    });
  } catch (error) {
    console.error('[Import Manual] Erro:', error);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}
