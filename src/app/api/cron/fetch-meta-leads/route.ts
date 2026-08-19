import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';
import { notifyNewLead, notifyQueueUpdate } from '@/lib/telegram';
import { assignLeadToUser, peekNextUser } from '@/lib/lead-queue';
import { findCapConfigByFormId } from '@/lib/meta-conversions';
import { getMetaFieldValue, formatMetaPhone, extractCustomAnswers, formatCustomAnswersText } from '@/lib/meta-lead-utils';

// maxDuration=10s no Hobby (Vercel impõe). Pro permite até 300s.
export const maxDuration = 10;

// ============================================================
// GET /api/cron/fetch-meta-leads
//
// Cron job que busca novos leads no Meta a cada 5 minutos.
// Chamado pelo Vercel Cron, serviço externo ou botão admin.
//
// Autenticação (qualquer UMA das formas):
//   - Sessão NextAuth com role ADMIN (botão "Executar Agora")
//   - Header Authorization: Bearer <CRON_SECRET>
//   - Query param ?secret=<CRON_SECRET> (cron-job.org)
// ============================================================

// Timeout conservador para chamadas externas (Graph API)
const GRAPH_API_TIMEOUT_MS = 8_000;

// Limite máximo de form IDs por execução (evita abuso)
const MAX_FORM_IDS = 20;

// Limite máximo de leads processados por execução
const MAX_LEADS_PER_RUN = 50;

// In-flight lock: impede execução concorrente do polling
let isRunning = false;

interface MetaLead {
  id: string;
  field_data: Array<{ name: string; values: string[] }>;
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  form_id?: string;
  form_name?: string;
  created_time?: string;
}

async function authenticate(request: NextRequest): Promise<boolean> {
  // 1. Admin autenticado via sessão (botão "Executar Agora" da UI)
  try {
    const session = await getServerSession(authOptions);
    if (session?.user?.role === 'ADMIN') return true;
  } catch {}

  // 2. Vercel Cron / serviço externo via CRON_SECRET
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return false;
  }

  // Vercel Cron envia header Authorization: Bearer <secret>
  const authHeader = request.headers.get('authorization');
  if (authHeader === `Bearer ${cronSecret}`) return true;

  // Fallback: query param (para serviços externos como cron-job.org)
  const querySecret = new URL(request.url).searchParams.get('secret');
  if (querySecret === cronSecret) return true;

  return false;
}

async function getConfig() {
  const settings = await db.userSettings.findMany({
    where: { key: { in: ['meta_polling_enabled', 'meta_polling_form_ids', 'meta_page_access_token', 'meta_polling_last_run'] } },
    select: { key: true, value: true },
  });
  const map: Record<string, string> = {};
  settings.forEach(s => { map[s.key] = s.value; });
  return {
    enabled: map['meta_polling_enabled'] === 'true',
    formIds: (() => { try { return JSON.parse(map['meta_polling_form_ids'] || '[]'); } catch { return []; } })(),
    pageAccessToken: map['meta_page_access_token'] || null,
    lastRun: map['meta_polling_last_run'] || null,
  };
}

async function fetchRecentLeads(formId: string, pageAccessToken: string, since: string): Promise<MetaLead[]> {
  const url = `https://graph.facebook.com/v22.0/${formId}/leads?fields=field_data,ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,form_id,form_name,created_time&limit=100&since=${encodeURIComponent(since)}&access_token=${encodeURIComponent(pageAccessToken)}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), GRAPH_API_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP ${response.status}: ${errorText.slice(0, 200)}`);
    }
    const data = await response.json();
    return data?.data || [];
  } finally {
    clearTimeout(timeoutId);
  }
}

async function importSingleLead(lead: MetaLead, creatorId: string): Promise<{ leadgenId: string; imported: boolean; clientName?: string; reason?: string; assignedTo?: string }> {
  const leadgenId = lead.id;
  const fieldData = lead.field_data;
  const formId = lead.form_id || '';
  const adName = lead.ad_name || 'Meta Ads';
  const campaignName = lead.campaign_name || '';
  const formName = lead.form_name || '';

  // 1. Dedup por metaLeadgenId
  const existing = await db.client.findUnique({ where: { metaLeadgenId: leadgenId }, select: { id: true, name: true } });
  if (existing) return { leadgenId, imported: false, clientName: existing.name, reason: 'já_existente' };

  // 2. Extrair campos
  const rawName = getMetaFieldValue(fieldData, 'full_name') || getMetaFieldValue(fieldData, 'name') || getMetaFieldValue(fieldData, 'nome') || getMetaFieldValue(fieldData, 'nome_completo') || 'Lead Meta Ads';
  const rawEmail = getMetaFieldValue(fieldData, 'email') || getMetaFieldValue(fieldData, 'e_mail') || null;
  const rawPhone = getMetaFieldValue(fieldData, 'phone_number') || getMetaFieldValue(fieldData, 'phone') || getMetaFieldValue(fieldData, 'celular') || getMetaFieldValue(fieldData, 'telefone') || null;
  const city = getMetaFieldValue(fieldData, 'city') || getMetaFieldValue(fieldData, 'cidade') || null;
  const name = rawName?.trim() || 'Lead Meta Ads';
  const email = rawEmail?.trim() || null;
  const phone = formatMetaPhone(rawPhone);
  const region = city?.trim() || null;
  const customAnswers = extractCustomAnswers(fieldData);
  const customAnswersText = formatCustomAnswersText(customAnswers);

  // 3. Dedup por telefone/email (soft)
  const existingByContact = await db.client.findFirst({
    where: { OR: [...(phone ? [{ phone }] : []), ...(email ? [{ email }] : [])] },
    orderBy: { createdAt: 'desc' },
  });
  if (existingByContact) {
    await db.client.update({ where: { id: existingByContact.id }, data: { metaLeadgenId: leadgenId, lastInteractionAt: new Date() } }).catch(() => {});
    await db.interaction.create({ data: { clientId: existingByContact.id, description: `[Meta Polling] Lead ${leadgenId} detectado pelo polling. Dados: ${email ? `Email: ${email}` : ''}${phone ? ` | Tel: ${phone}` : ''}.${customAnswersText}` } });
    return { leadgenId, imported: false, clientName: existingByContact.name, reason: 'cliente_existente_atualizado' };
  }

  // 4. CAPI config
  let capiConfigId: string | undefined;
  if (formId) { try { const m = await findCapConfigByFormId(formId); if (m) capiConfigId = m.id; } catch {} }

  // 5. Criar cliente
  const newClient = await db.client.create({
    data: {
      name, email: email || undefined, phone: phone || undefined, region: region || undefined,
      stage: 'LEAD', updatePeriod: 1, createdBy: creatorId, metaLeadgenId: leadgenId, metaCapConfigId: capiConfigId,
      notes: `[Meta Ads] Lead importado por polling automático.\nAnúncio: ${adName}${campaignName ? `\nCampanha: ${campaignName}` : ''}\nFormulário: ${formName}${formId ? ` (ID: ${formId})` : ''}\nLead ID: ${leadgenId}${lead.created_time ? `\nCriado em: ${lead.created_time}` : ''}${capiConfigId ? `\nCAPI Config: ${capiConfigId}` : ''}${customAnswersText}`,
    },
  });
  await db.interaction.create({ data: { clientId: newClient.id, description: `[Meta Polling] Cliente criado via polling automático. Anúncio: ${adName}.${customAnswersText}` } });

  // 6. Atribuir à fila
  let assignedUserName: string | undefined;
  let assignedUserId: string | undefined;
  let assignedQueueId: string | undefined;
  try {
    const r = await assignLeadToUser({ leadId: newClient.id, source: `meta_ads:polling:${campaignName || adName || ''}` });
    if (r.assigned && r.userId) {
      assignedUserId = r.userId; assignedQueueId = r.queueId; assignedUserName = r.userName;
      await db.client.update({ where: { id: newClient.id }, data: { createdBy: r.userId, utmSource: 'meta_ads', utmCampaign: (campaignName || '').slice(0, 200) || undefined } }).catch(() => {});
    }
  } catch (e) { console.error(`[Meta Polling] Falha fila ${newClient.id}:`, e); }

  // 7. Notificar agente (await)
  const notifyId = assignedUserId || creatorId;
  if (notifyId) {
    try {
      const u = await db.user.findUnique({ where: { id: notifyId }, select: { telegramChatId: true, name: true } });
      if (u?.telegramChatId) {
        await notifyNewLead(u.telegramChatId, { leadName: newClient.name, leadPhone: newClient.phone || '', leadEmail: newClient.email || '', enterpriseName: undefined, utmCampaign: campaignName || null, utmSource: 'meta_ads', slug: undefined, assignedUserName, customAnswers });
      }
    } catch (e) { console.warn('[Meta Polling] Falha notificação agente:', e); }
  }

  // 8. Notificar admin (await)
  if (assignedUserId && assignedQueueId) {
    try {
      const admin = await db.user.findFirst({ where: { role: 'ADMIN' }, select: { telegramChatId: true } });
      if (admin?.telegramChatId) {
        const next = await peekNextUser({ queueId: assignedQueueId });
        await notifyQueueUpdate(admin.telegramChatId, { source: `meta_ads:polling:${campaignName || adName || ''}`, assignedUserName: assignedUserName || '?', nextUserName: next?.userName || null, leadName: newClient.name, leadPhone: newClient.phone || undefined });
      }
    } catch (e) { console.warn('[Meta Polling] Falha notificação admin:', e); }
  }

  return { leadgenId, imported: true, clientName: name, assignedTo: assignedUserName };
}

export async function GET(request: NextRequest) {
  const startTime = Date.now();

  // 1. Autenticação
  if (!(await authenticate(request))) {
    return NextResponse.json({ error: 'Não autorizado' }, { status: 401 });
  }

  // 2. Concurrency guard — impede execução paralela
  if (isRunning) {
    return NextResponse.json({ status: 'already_running', message: 'Polling já está em execução' });
  }
  isRunning = true;

  try {
    // 3. Config
    const config = await getConfig();
    if (!config.enabled) {
      return NextResponse.json({ status: 'disabled', message: 'Polling desativado' });
    }
    if (!config.pageAccessToken) {
      return NextResponse.json({ status: 'error', message: 'Page Access Token não configurado' });
    }
    if (config.formIds.length === 0) {
      return NextResponse.json({ status: 'idle', message: 'Nenhum form ID configurado' });
    }
    if (config.formIds.length > MAX_FORM_IDS) {
      return NextResponse.json({ status: 'error', message: `Máximo de ${MAX_FORM_IDS} formulários permitidos` });
    }

    // 4. Determinar janela de busca
    const lastRunTime = config.lastRun ? new Date(config.lastRun).getTime() : Date.now() - 30 * 60 * 1000;
    const since = new Date(lastRunTime - 60 * 1000).toISOString();
    const now = new Date().toISOString();

    console.log(`[Meta Polling] Iniciando: forms=[${config.formIds.join(', ')}], since=${since}`);

    // 5. Buscar leads de cada formulário
    let totalFetched = 0;
    let totalImported = 0;
    const errors: string[] = [];
    let reachedLimit = false;

    // Buscar creator UMA vez (não repetir por formulário)
    const admin = await db.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true }, orderBy: { createdAt: 'asc' } });
    let creatorId = admin?.id;
    if (!creatorId) { const any = await db.user.findFirst({ select: { id: true } }); creatorId = any?.id; }
    if (!creatorId) { errors.push('Nenhum usuário no sistema'); }

    for (const formId of config.formIds) {
      if (reachedLimit || !creatorId) continue;

      try {
        const leads = await fetchRecentLeads(formId, config.pageAccessToken, since);
        console.log(`[Meta Polling] Form ${formId}: ${leads.length} leads encontrados`);
        totalFetched += leads.length;

        // Ordenar por created_time ASC
        leads.sort((a, b) => (a.created_time ? new Date(a.created_time).getTime() : 0) - (b.created_time ? new Date(b.created_time).getTime() : 0));

        for (const lead of leads) {
          if (totalImported >= MAX_LEADS_PER_RUN) {
            reachedLimit = true;
            errors.push(`Limite de ${MAX_LEADS_PER_RUN} leads atingido. Os demais serão importados na próxima execução.`);
            break;
          }
          try {
            const result = await importSingleLead(lead, creatorId);
            if (result.imported) totalImported++;
          } catch (e) {
            console.error(`[Meta Polling] Erro ao importar ${lead.id}:`, e);
            errors.push(`${lead.id}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      } catch (e) {
        const msg = `Form ${formId}: ${e instanceof Error ? e.message : String(e)}`;
        console.error(`[Meta Polling] ${msg}`);
        errors.push(msg);
      }
    }

    // 6. Atualizar last_run
    await db.userSettings.upsert({
      where: { key: 'meta_polling_last_run' },
      update: { value: now },
      create: { key: 'meta_polling_last_run', value: now },
    }).catch(() => {});

    // Salvar resultado do último run (sem expor errors crusos no log)
    const lastResult = JSON.stringify({
      timestamp: now, totalFetched, totalImported, errorCount: errors.length,
      forms: config.formIds.length, elapsed: Date.now() - startTime,
    });
    await db.userSettings.upsert({
      where: { key: 'meta_polling_last_result' },
      update: { value: lastResult },
      create: { key: 'meta_polling_last_result', value: lastResult },
    }).catch(() => {});

    const elapsed = Date.now() - startTime;
    console.log(`[Meta Polling] Concluído em ${elapsed}ms: ${totalFetched} buscados, ${totalImported} importados, ${errors.length} erros`);

    return NextResponse.json({
      status: 'ok', elapsed: `${elapsed}ms`,
      formsChecked: config.formIds.length,
      totalFetched, totalImported,
      errors: errors.length > 0 ? errors : undefined,
    });
  } finally {
    isRunning = false;
  }
}
