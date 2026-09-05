import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { db } from '@/lib/db';
import { notifyNewLead, notifyQueueUpdate } from '@/lib/telegram';
import { assignLeadToUser, peekNextUser } from '@/lib/lead-queue';
import { findCapConfigByFormId } from '@/lib/meta-conversions';
import { resolveQueueForMetaLead, mapWithConcurrency } from '@/lib/meta-lead-routing';
import { getMetaFieldValue, formatMetaPhone, extractCustomAnswers, formatCustomAnswersText } from '@/lib/meta-lead-utils';
import { fetchEnabledAdAccounts, parseJsonArray, upsertCampaignBindingAuto } from '@/lib/meta-ad-accounts';

// maxDuration=10s no Hobby (Vercel impõe). Pro permite até 300s.
export const maxDuration = 10;

// ============================================================
// GET /api/cron/fetch-meta-leads
//
// Cron job que busca novos leads no Meta a cada 5 minutos.
// Chamado pelo Vercel Cron, serviço externo ou botão admin.
//
// MULTI-ANÚNCIO + MULTI-CONTA: todos os formulários são consultados EM PARALELO
// com watermark individual por formulário — se a busca de um form
// falha, os demais avançam normalmente e o form com falha repete
// a janela na próxima execução (nenhum lead é pulado). Cada lead
// é roteado para a fila de atendimento do seu formulário/campanha/
// conta de origem (meta-lead-routing), igual ao webhook — assim webhook
// e polling podem rodar simultaneamente sem confundir fontes.
//
// MULTI-TOKEN: cada conta de anúncios (MetaAdAccount) é consultada
// com o PRÓPRIO access token, usando os formIds vinculados a ela.
// Formulários sem conta continuam usando o token global (legado).
//
// Autenticação (qualquer UMA das formas):
//   - Sessão NextAuth com role ADMIN (botão "Executar Agora")
//   - Header Authorization: Bearer <CRON_SECRET>
//   - Query param ?secret=<CRON_SECRET> (cron-job.org)
// ============================================================

// Timeout conservador para chamadas externas (Graph API)
const GRAPH_API_TIMEOUT_MS = 8_000;

// Limite máximo de form IDs por execução (evita abuso).
// Multi-conta: o total soma forms de todas as contas + globais.
const MAX_FORM_IDS = 50;

// Limite máximo de leads processados por execução
const MAX_LEADS_PER_RUN = 50;

// Concorrência de consultas aos formulários na Graph API
const FORM_CONCURRENCY = 4;

// Concorrência de importação de leads dentro de um formulário
const LEAD_CONCURRENCY = 5;

// In-flight lock: impede execução concorrente do polling (por instância)
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

/** Alvo de polling: um form consultado com o token da sua conta (ou global). */
interface PollTarget {
  formId: string;
  token: string;
  adAccountId: string | null;
  accountName: string | null;
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
    where: { key: { in: ['meta_polling_enabled', 'meta_polling_form_ids', 'meta_page_access_token', 'meta_polling_last_run', 'meta_polling_form_watermarks'] } },
    select: { key: true, value: true },
  });
  const map: Record<string, string> = {};
  settings.forEach(s => { map[s.key] = s.value; });

  // Watermarks individuais por formulário: { "formId": "ISO-date", ... }
  let formWatermarks: Record<string, string> = {};
  try { formWatermarks = JSON.parse(map['meta_polling_form_watermarks'] || '{}') || {}; } catch { formWatermarks = {}; }

  return {
    enabled: map['meta_polling_enabled'] === 'true',
    formIds: (() => { try { return JSON.parse(map['meta_polling_form_ids'] || '[]'); } catch { return []; } })(),
    pageAccessToken: map['meta_page_access_token'] || null,
    lastRun: map['meta_polling_last_run'] || null,
    formWatermarks,
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

async function importSingleLead(
  lead: MetaLead,
  creatorId: string,
  queueId: string | undefined,
  quota: { remaining: number },
  adAccountId: string | null,
): Promise<{ leadgenId: string; imported: boolean; clientName?: string; reason?: string; assignedTo?: string }> {
  const leadgenId = lead.id;
  const fieldData = lead.field_data;
  const formId = lead.form_id || '';
  const adName = lead.ad_name || 'Meta Ads';
  const campaignName = lead.campaign_name || '';
  const campaignId = lead.campaign_id || '';
  const formName = lead.form_name || '';

  // 1. Dedup por metaLeadgenId
  const existing = await db.client.findUnique({ where: { metaLeadgenId: leadgenId }, select: { id: true, name: true } });
  if (existing) return { leadgenId, imported: false, clientName: existing.name, reason: 'já_existente' };

  // 1b. Auto-registro campanha → conta (fire-and-forget; fila específica
  //     por campanha via MetaCampaignBinding — igual ao webhook)
  if (campaignId) {
    upsertCampaignBindingAuto({ campaignId, campaignName, adAccountId });
  }

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

  // 6. Atribuir à fila roteada pela origem do lead (form/config), não à default cega
  let assignedUserName: string | undefined;
  let assignedUserId: string | undefined;
  let assignedQueueId: string | undefined;
  try {
    const r = await assignLeadToUser({ leadId: newClient.id, queueId, source: `meta_ads:polling:${campaignName || adName || ''}` });
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
        // Try to find enterprise by ad name (adName usually matches enterprise name, e.g. "Vitta")
        let entName: string | undefined;
        let entImageUrl: string | undefined;
        if (adName && adName !== 'Meta Ads') {
          try {
            const ent = await db.enterprise.findFirst({
              where: { name: { contains: adName, mode: 'insensitive' } },
              select: { name: true, imageUrl: true },
            });
            if (ent) { entName = ent.name; entImageUrl = ent.imageUrl || undefined; }
          } catch {}
        }
        await notifyNewLead(u.telegramChatId, { leadName: newClient.name, leadPhone: newClient.phone || '', leadEmail: newClient.email || '', enterpriseName: entName, enterpriseImageUrl: entImageUrl, utmCampaign: campaignName || null, utmSource: 'meta_ads', slug: undefined, assignedUserName, customAnswers });
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

  // 2. Concurrency guard — impede execução paralela entre instâncias locais
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

    // 3b. MULTI-TOKEN: contas de anúncios habilitadas + alvos por conta
    const adAccounts = await fetchEnabledAdAccounts();
    const targets: PollTarget[] = [];
    const claimedForms = new Set<string>();
    for (const account of adAccounts) {
      const forms = parseJsonArray(account.formIds);
      if (forms.length === 0) continue;
      if (!account.accessToken) {
        console.warn(`[Meta Polling] Conta "${account.name}" sem access token — ${forms.length} form(s) dela pulados`);
        continue;
      }
      for (const formId of forms) {
        if (claimedForms.has(formId)) continue;
        claimedForms.add(formId);
        targets.push({ formId, token: account.accessToken, adAccountId: account.id, accountName: account.name });
      }
    }

    // Legado: forms globais consultados com o token global (sem conta)
    if (config.pageAccessToken) {
      for (const formId of config.formIds as string[]) {
        if (claimedForms.has(formId)) continue;
        claimedForms.add(formId);
        targets.push({ formId, token: config.pageAccessToken, adAccountId: null, accountName: null });
      }
    }

    if (!config.pageAccessToken && targets.length === 0) {
      return NextResponse.json({ status: 'error', message: 'Nenhum token configurado (global ou em contas de anúncios)' });
    }
    if (targets.length === 0) {
      return NextResponse.json({ status: 'idle', message: 'Nenhum form ID configurado (nem global nem em contas de anúncios)' });
    }
    if (targets.length > MAX_FORM_IDS) {
      return NextResponse.json({ status: 'error', message: `Máximo de ${MAX_FORM_IDS} formulários permitidos (somando contas + globais)` });
    }

    // 4. Janela de busca: watermark INDIVIDUAL por formulário.
    //    Fallback: last_run global (compatibilidade) ou 30 min.
    const globalFallback = config.lastRun ? new Date(config.lastRun).getTime() : Date.now() - 30 * 60 * 1000;
    const nowIso = new Date().toISOString();

    const accountCount = new Set(targets.map(t => t.accountName).filter(Boolean)).size;
    console.log(`[Meta Polling] Iniciando: alvos=${targets.length} (contas=${accountCount}, legados=${targets.length - targets.filter(t => t.adAccountId).length}), watermarks=${Object.keys(config.formWatermarks).length || 'nenhum (usando last_run global)'}`);

    // 5. Buscar creator UMA vez
    const admin = await db.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true }, orderBy: { createdAt: 'asc' } });
    let creatorId = admin?.id;
    if (!creatorId) { const any = await db.user.findFirst({ select: { id: true } }); creatorId = any?.id; }

    // Quota compartilhada entre todos os formulários paralelos
    const quota = { remaining: MAX_LEADS_PER_RUN };

    // Resultado por alvo (observabilidade)
    const perForm: Array<{ formId: string; account?: string | null; fetched: number; imported: number; error?: string }> = [];
    const newWatermarks: Record<string, string> = { ...config.formWatermarks };
    const errors: string[] = [];

    // 6. Processar alvos EM PARALELO (cada form é independente;
    //    cada conta usa o PRÓPRIO token — isolamento entre contas)
    await mapWithConcurrency(targets, FORM_CONCURRENCY, async (target) => {
      const { formId, token, adAccountId, accountName } = target;
      if (!creatorId || quota.remaining <= 0) {
        perForm.push({ formId, account: accountName, fetched: 0, imported: 0, error: 'pulando (sem usuário ou quota esgotada)' });
        return;
      }

      // Roteamento multi-anúncio/multi-conta: fila dedicada desta
      // campanha/formulário/conta (uma resolução por alvo — aplica-se
      // a todos os leads dele)
      const route = await resolveQueueForMetaLead({ formId, adAccountId: adAccountId || undefined });
      if (route.routeSource !== 'default') {
        console.log(`[Meta Polling] Form ${formId}${accountName ? ` (conta: ${accountName})` : ''} → fila "${route.queueName ?? route.queueId}" (${route.routeSource})`);
      }

      // Watermark individual: usa a última execução BEM-SUCEDIDA deste form
      const formWatermark = config.formWatermarks[formId];
      const sinceMs = formWatermark ? new Date(formWatermark).getTime() : globalFallback;
      const since = new Date(sinceMs - 60 * 1000).toISOString();

      try {
        const leads = await fetchRecentLeads(formId, token, since);
        console.log(`[Meta Polling] Form ${formId}${accountName ? ` (conta: ${accountName})` : ''}: ${leads.length} leads encontrados (since=${since})`);

        // Ordenar por created_time ASC
        leads.sort((a, b) => (a.created_time ? new Date(a.created_time).getTime() : 0) - (b.created_time ? new Date(b.created_time).getTime() : 0));

        let imported = 0;

        // Leads do mesmo formulário em paralelo (concorrência limitada)
        const settledLeads = await mapWithConcurrency(leads, LEAD_CONCURRENCY, async (lead) => {
          if (quota.remaining <= 0) return { skipped: true, imported: false };
          const result = await importSingleLead(lead, creatorId, route.queueId, quota, adAccountId);
          if (result.imported) {
            quota.remaining--;
            imported++;
          }
          return { skipped: false, imported: result.imported };
        });

        for (const s of settledLeads) {
          if (s.status === 'rejected') {
            const msg = s.reason instanceof Error ? s.reason.message : String(s.reason);
            errors.push(`${formId}: ${msg}`);
          }
        }

        if (quota.remaining <= 0 && leads.length > imported) {
          errors.push(`Limite de ${MAX_LEADS_PER_RUN} leads atingido. Os demais serão importados na próxima execução.`);
        }

        perForm.push({ formId, account: accountName, fetched: leads.length, imported });

        // Sucesso na busca: avança o watermark DESTE formulário
        newWatermarks[formId] = nowIso;
      } catch (e) {
        // Falha na busca do form: NÃO avança o watermark deste form —
        // a próxima execução repete a janela e nenhum lead é perdido
        const msg = `Form ${formId}${accountName ? ` (conta: ${accountName})` : ''}: ${e instanceof Error ? e.message : String(e)}`;
        console.error(`[Meta Polling] ${msg}`);
        errors.push(msg);
        perForm.push({ formId, account: accountName, fetched: 0, imported: 0, error: msg });
      }
    });

    const totalFetched = perForm.reduce((acc, f) => acc + f.fetched, 0);
    const totalImported = perForm.reduce((acc, f) => acc + f.imported, 0);

    // 7. Atualizar last_run global (compatibilidade com a UI)
    await db.userSettings.upsert({
      where: { key: 'meta_polling_last_run' },
      update: { value: nowIso },
      create: { key: 'meta_polling_last_run', value: nowIso },
    }).catch(() => {});

    // 8. Persistir watermarks individuais por formulário
    await db.userSettings.upsert({
      where: { key: 'meta_polling_form_watermarks' },
      update: { value: JSON.stringify(newWatermarks) },
      create: { key: 'meta_polling_form_watermarks', value: JSON.stringify(newWatermarks) },
    }).catch(() => {});

    // Salvar resultado do último run (sem expor errors crusos no log)
    const lastResult = JSON.stringify({
      timestamp: nowIso, totalFetched, totalImported, errorCount: errors.length,
      forms: targets.length, accounts: accountCount, elapsed: Date.now() - startTime, perForm,
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
      formsChecked: targets.length,
      accountsChecked: accountCount,
      totalFetched, totalImported,
      perForm,
      errors: errors.length > 0 ? errors : undefined,
    });
  } finally {
    isRunning = false;
  }
}
