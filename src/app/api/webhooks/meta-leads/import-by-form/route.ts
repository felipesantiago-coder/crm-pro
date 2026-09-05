import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/api-auth';
import { notifyNewLead, notifyQueueUpdate } from '@/lib/telegram';
import { assignLeadToUser, peekNextUser } from '@/lib/lead-queue';
import { findCapConfigByFormId } from '@/lib/meta-conversions';
import { getMetaFieldValue, formatMetaPhone, extractCustomAnswers, formatCustomAnswersText } from '@/lib/meta-lead-utils';
import { fetchEnabledAdAccounts } from '@/lib/meta-ad-accounts';

// ============================================================
// POST /api/webhooks/meta-leads/import-by-form
// Busca leads de um formulário do Meta Lead Ads por período
// e importa os que ainda não existem no CRM.
//
// Body: { formId: string, fromDate: string, toDate?: string }
//   - fromDate/toDate: ISO date string (YYYY-MM-DD) ou ISO datetime
// ============================================================

interface MetaLead {
  id: string;
  field_data: Array<{ name: string; values: string[] }>;
  ad_id?: string;
  campaign_id?: string;
  form_id?: string;
  created_time?: string;
}

interface MetaLeadsResponse {
  data: MetaLead[];
  paging?: {
    cursors?: { after?: string; before?: string };
    next?: string;
  };
}

// getFieldValue e formatPhone agora vêm de @/lib/meta-lead-utils

/**
 * Busca todos os leads de um formulário no Meta, com paginação.
 * Usa o Page Access Token (não precisa de ads_read, só leads_retrieval).
 */
async function fetchLeadsFromForm(
  formId: string,
  pageAccessToken: string,
  since: string,
  until: string
): Promise<MetaLead[]> {
  const allLeads: MetaLead[] = [];
  let url = `https://graph.facebook.com/v22.0/${formId}/leads?fields=field_data,ad_id,campaign_id,form_id,created_time&limit=100&since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}&access_token=${encodeURIComponent(pageAccessToken)}`;

  let page = 0;
  const MAX_PAGES = 20; // segurança: máximo 20 páginas (2000 leads)

  while (url && page < MAX_PAGES) {
    page++;
    console.log(`[Import by Form] Página ${page}: ${url.split('?')[0]}...`);

    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Import by Form] Falha na página ${page}: HTTP ${response.status} — ${errorText.slice(0, 500)}`);
      throw new Error(`Erro ao buscar leads do Meta (página ${page}): HTTP ${response.status}. ${errorText.slice(0, 200)}`);
    }

    const data: MetaLeadsResponse = await response.json();

    if (!data.data || !Array.isArray(data.data)) {
      console.warn(`[Import by Form] Resposta sem data na página ${page}`);
      break;
    }

    console.log(`[Import by Form] Página ${page}: ${data.data.length} leads encontrados`);
    allLeads.push(...data.data);

    // Paginação: usar next URL ou cursor
    if (data.paging?.next) {
      url = data.paging.next;
    } else if (data.paging?.cursors?.after) {
      url = `https://graph.facebook.com/v22.0/${formId}/leads?fields=field_data,ad_id,campaign_id,form_id,created_time&limit=100&after=${encodeURIComponent(data.paging.cursors.after)}&access_token=${encodeURIComponent(pageAccessToken)}`;
    } else {
      break;
    }
  }

  if (page >= MAX_PAGES && url) {
    console.warn(`[Import by Form] Atingiu limite de ${MAX_PAGES} páginas. Alguns leads podem não ter sido buscados.`);
  }

  return allLeads;
}

/**
 * Processa um único lead (mesma lógica do import-manual e do webhook)
 */
async function processLead(
  lead: MetaLead,
  creatorId: string,
  formId: string
): Promise<{
  leadgenId: string;
  success: boolean;
  clientName?: string;
  clientId?: string;
  reason?: string;
  assignedTo?: string;
  isNew: boolean;
}> {
  const leadgenId = lead.id;
  const fieldData = lead.field_data;
  const campaignId = String(lead.campaign_id || '');

  // Extrair campos
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

  // 1. Verificar duplicata por metaLeadgenId
  try {
    const existing = await db.client.findUnique({
      where: { metaLeadgenId: leadgenId },
      select: { id: true, name: true },
    });
    if (existing) {
      return { leadgenId, success: true, clientName: existing.name, clientId: existing.id, reason: 'já_existente', isNew: false };
    }
  } catch (dedupErr) {
    console.warn(`[Import by Form] Falha ao verificar duplicata para ${leadgenId}:`, dedupErr);
  }

  // 2. Verificar duplicata por telefone/email
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
        description: `[Meta Ads] Lead ${leadgenId} importado por formulário. Dados: ${email ? `Email: ${email}` : ''}${phone ? ` | Telefone: ${phone}` : ''}${region ? ` | Cidade: ${region}` : ''}.${customAnswersText}`,
      },
    });

    // Tentar atribuir à fila
    let assignedTo: string | undefined;
    let assignedUserId: string | undefined;
    let assignedQueueId: string | undefined;
    try {
      const assignResult = await assignLeadToUser({ leadId: existingByContact.id, source: 'meta_ads:import_by_form' });
      if (assignResult.assigned && assignResult.message !== 'already_assigned') {
        // New assignment — notify agent
        assignedTo = assignResult.userName;
        assignedUserId = assignResult.userId;
        assignedQueueId = assignResult.queueId;
        await db.client.update({ where: { id: existingByContact.id }, data: { createdBy: assignResult.userId! } }).catch(() => {});
        // Notificar agente (await — serverless-safe)
        try {
          const agentUser = await db.user.findUnique({ where: { id: assignResult.userId }, select: { telegramChatId: true, name: true } });
          if (agentUser?.telegramChatId) {
            await notifyNewLead(agentUser.telegramChatId, {
              leadName: existingByContact.name,
              leadPhone: phone || existingByContact.phone || '',
              leadEmail: email || existingByContact.email || '',
              enterpriseName: undefined,
              utmCampaign: `import_by_form:${formId}`,
              utmSource: 'meta_ads',
              slug: undefined,
              assignedUserName: assignResult.userName,
              customAnswers,
            });
          }
        } catch (notifyErr) { console.warn('[Import by Form] Falha notificação agente (existente):', notifyErr); }
        // Notify admin (await — serverless-safe)
        if (assignResult.queueId) {
          try {
            const adminUser = await db.user.findFirst({ where: { role: 'ADMIN' }, select: { telegramChatId: true } });
            if (adminUser?.telegramChatId) {
              const nextUser = await peekNextUser({ queueId: assignResult.queueId });
              await notifyQueueUpdate(adminUser.telegramChatId, {
                source: 'meta_ads:import_by_form',
                assignedUserName: assignResult.userName || 'Desconhecido',
                nextUserName: nextUser?.userName || null,
                leadName: existingByContact.name,
                leadPhone: phone || undefined,
              });
            }
          } catch (err) { console.warn('[Import by Form] Admin notification failed (existing):', err instanceof Error ? err.message : err); }
        }
      } else if (assignResult.assigned) {
        // already_assigned — no notification needed, queue didn't advance
        assignedTo = assignResult.userName;
      }
    } catch {}

    return { leadgenId, success: true, clientName: existingByContact.name, clientId: existingByContact.id, reason: 'cliente_existente_atualizado', assignedTo, isNew: false };
  }

  // 3. Buscar CAPI config
  let capiConfigId: string | undefined;
  if (formId) {
    try {
      const capiMatch = await findCapConfigByFormId(formId);
      if (capiMatch) capiConfigId = capiMatch.id;
    } catch {}
  }

  // 4. Criar cliente
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
        notes: `[Meta Ads] Lead importado por formulário e período.\nLead ID: ${leadgenId}${formId ? `\nForm ID: ${formId}` : ''}${campaignId ? `\nCampaign ID: ${campaignId}` : ''}${lead.created_time ? `\nCriado em: ${lead.created_time}` : ''}${customAnswersText}`,
      },
    });

    await db.interaction.create({
      data: {
        clientId: newClient.id,
        description: `[Meta Ads] Lead importado por formulário + período. Origem: Facebook/Instagram Lead Ads.${customAnswersText}`,
      },
    });

    // 5. Atribuir à fila
    let assignedTo: string | undefined;
    let assignedUserId: string | undefined;
    let assignedQueueId: string | undefined;
    try {
      const assignResult = await assignLeadToUser({ leadId: newClient.id, source: 'meta_ads:import_by_form' });
      if (assignResult.assigned && assignResult.userId) {
        assignedTo = assignResult.userName;
        assignedUserId = assignResult.userId;
        assignedQueueId = assignResult.queueId;
        await db.client.update({
          where: { id: newClient.id },
          data: { createdBy: assignResult.userId, utmSource: 'meta_ads', utmCampaign: `import_by_form:${formId}` },
        }).catch(() => {});
      }
    } catch (queueErr) {
      console.error(`[Import by Form] Falha na fila para ${newClient.id}:`, queueErr);
    }

    // 6. Notificação Telegram para o atendente (await — serverless-safe)
    const notifyId = assignedUserId || creatorId;
    if (notifyId) {
      try {
        const agentUser = await db.user.findUnique({ where: { id: notifyId }, select: { telegramChatId: true, name: true } });
        if (agentUser?.telegramChatId) {
          await notifyNewLead(agentUser.telegramChatId, {
            leadName: newClient.name,
            leadPhone: newClient.phone || '',
            leadEmail: newClient.email || '',
            enterpriseName: undefined,
            utmCampaign: `import_by_form:${formId}`,
            utmSource: 'meta_ads',
            slug: undefined,
            assignedUserName: assignedTo,
            customAnswers,
          });
        }
      } catch (notifyErr) { console.warn('[Import by Form] Falha notificação agente:', notifyErr); }
    }

    // 7. Notify admin about queue rotation (await — serverless-safe)
    if (assignedUserId && assignedQueueId) {
      try {
        const adminUser = await db.user.findFirst({ where: { role: 'ADMIN' }, select: { telegramChatId: true } });
        if (adminUser?.telegramChatId) {
          const nextUser = await peekNextUser({ queueId: assignedQueueId });
          await notifyQueueUpdate(adminUser.telegramChatId, {
            source: `meta_ads:import_by_form:${formId}`,
            assignedUserName: assignedTo || 'Desconhecido',
            nextUserName: nextUser?.userName || null,
            leadName: newClient.name,
            leadPhone: newClient.phone || undefined,
          });
        }
      } catch (err) { console.warn('[Import by Form] Admin notification failed:', err instanceof Error ? err.message : err); }
    }

    console.log(`[Import by Form] ✅ Lead ${leadgenId} importado como client ${newClient.id} (${name})`);
    return { leadgenId, success: true, clientName: name, clientId: newClient.id, assignedTo, isNew: true };
  } catch (createErr) {
    console.error(`[Import by Form] Erro ao criar cliente para lead ${leadgenId}:`, createErr);
    return { leadgenId, success: false, clientName: name, reason: 'Erro ao criar cliente no banco', isNew: false };
  }
}

export async function POST(request: NextRequest) {
  try {
    const { error } = await requireAdmin();
    if (error) return error;

    const body = await request.json();
    const { formId, fromDate, toDate, accountId } = body as {
      formId?: string;
      fromDate?: string;
      toDate?: string;
      accountId?: string;
    };

    // Validações
    if (!formId || !fromDate) {
      return NextResponse.json(
        { error: 'formId e fromDate são obrigatórios' },
        { status: 400 }
      );
    }

    // Parsear fromDate: aceita YYYY-MM-DD ou ISO datetime
    let since: string;
    const fromParsed = Date.parse(fromDate);
    if (isNaN(fromParsed)) {
      return NextResponse.json({ error: 'fromDate inválido. Use YYYY-MM-DD ou ISO datetime.' }, { status: 400 });
    }
    since = new Date(fromParsed).toISOString();

    // Parsear toDate: aceita YYYY-MM-DD (fim do dia) ou ISO datetime
    let until: string;
    if (toDate) {
      const toParsed = Date.parse(toDate);
      if (isNaN(toParsed)) {
        return NextResponse.json({ error: 'toDate inválido. Use YYYY-MM-DD ou ISO datetime.' }, { status: 400 });
      }
      // Se o usuário passou só data (sem hora), usar fim do dia
      const toDateObj = new Date(toParsed);
      if (toDate.length <= 10) {
        toDateObj.setHours(23, 59, 59, 999);
      }
      until = toDateObj.toISOString();
    } else {
      // Sem toDate: usar agora
      until = new Date().toISOString();
    }

    console.log(`[Import by Form] Iniciando: formId=${formId}, desde=${since}, até=${until}`);

    // Tokens nas CONTAS de anúncios (configuração EXCLUSIVAMENTE por
    // conta — não existe mais token global). accountId = preferência;
    // sem sucesso no preferido, tenta as demais contas (o formulário
    // pode pertencer a outra página/conta).
    const accounts = await fetchEnabledAdAccounts('all');
    if (accounts.length === 0) {
      return NextResponse.json(
        { error: 'Nenhuma conta de anúncios configurada. Cadastre em Anúncios Meta > Contas de Anúncio com o access token dela.' },
        { status: 400 }
      );
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

    // Buscar todos os leads do formulário no Meta — tenta o token de
    // cada conta (preferida primeiro) até obter sucesso
    let metaLeads: MetaLead[] = [];
    let lastFetchError: any = null;
    try {
      for (const token of tokenCandidates) {
        try {
          metaLeads = await fetchLeadsFromForm(formId, token, since, until);
          if (metaLeads.length > 0) break;
        } catch (err) {
          lastFetchError = err;
        }
      }
    } catch (fetchErr: any) {
      lastFetchError = fetchErr;
    }
    if (!metaLeads.length && lastFetchError) {
      console.error('[Import by Form] Erro ao buscar leads do Meta:', lastFetchError);
      return NextResponse.json(
        { error: lastFetchError.message || 'Erro ao buscar leads do Meta. Verifique se o Form ID pertence a uma página de uma das contas configuradas.' },
        { status: 502 }
      );
    }

    if (metaLeads.length === 0) {
      return NextResponse.json({
        total: 0,
        fetched: 0,
        imported: 0,
        alreadyExisted: 0,
        failed: 0,
        results: [],
        message: 'Nenhum lead encontrado neste formulário no período selecionado.',
      });
    }

    console.log(`[Import by Form] ${metaLeads.length} leads encontrados no Meta. Ordenando por created_time (mais antigo primeiro) para garantir distribuição cronológica na fila...`);

    // Ordenar leads por created_time ASC (mais antigo primeiro)
    // A API do Meta retorna em ordem reversa (mais recente primeiro).
    // Ordenar garante que a fila round-robin distribua na ordem real de cadastro.
    metaLeads.sort((a, b) => {
      const timeA = a.created_time ? new Date(a.created_time).getTime() : 0;
      const timeB = b.created_time ? new Date(b.created_time).getTime() : 0;
      return timeA - timeB;
    });

    console.log(`[Import by Form] Primeiro lead: ${metaLeads[0]?.id} (${metaLeads[0]?.created_time}), Último: ${metaLeads[metaLeads.length - 1]?.id} (${metaLeads[metaLeads.length - 1]?.created_time})`);

    // Processar cada lead
    const results: Array<{
      leadgenId: string;
      success: boolean;
      clientName?: string;
      clientId?: string;
      reason?: string;
      assignedTo?: string;
      isNew: boolean;
      createdTime?: string;
    }> = [];

    for (const lead of metaLeads) {
      try {
        const result = await processLead(lead, creatorId, formId);
        results.push({
          ...result,
          createdTime: lead.created_time,
        });
      } catch (err) {
        console.error(`[Import by Form] Erro inesperado ao processar lead ${lead.id}:`, err);
        results.push({
          leadgenId: lead.id,
          success: false,
          reason: 'Erro inesperado ao processar',
          isNew: false,
          createdTime: lead.created_time,
        });
      }
    }

    const succeeded = results.filter(r => r.success).length;
    const newLeads = results.filter(r => r.isNew).length;
    const alreadyExisted = results.filter(r => r.success && !r.isNew).length;
    const failed = results.filter(r => !r.success).length;

    console.log(`[Import by Form] Resumo: ${newLeads} novos, ${alreadyExisted} já existiam, ${failed} falhas (total: ${results.length})`);

    return NextResponse.json({
      total: metaLeads.length,
      fetched: metaLeads.length,
      imported: newLeads,
      alreadyExisted,
      failed,
      results,
      message: `${newLeads} lead${newLeads !== 1 ? 's' : ''} novo${newLeads !== 1 ? 's' : ''} importado${newLeads !== 1 ? 's' : ''}${alreadyExisted > 0 ? `, ${alreadyExisted} já existia${alreadyExisted !== 1 ? 'm' : ''}` : ''}${failed > 0 ? `, ${failed} falha(s)` : ''}`,  });
  } catch (error) {
    console.error('[Import by Form] Erro:', error);
    return NextResponse.json({ error: 'Erro interno do servidor' }, { status: 500 });
  }
}
