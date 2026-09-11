// ============================================================
// META INGEST — defaults REAIS dos serviços do pipeline
// ============================================================
// Este módulo é o ÚNICO ponto que amarra o pipeline aos módulos com
// efeitos reais (Prisma, Graph API, Telegram, fila). As rotas usam
// `createMetaIngestServices(db)`; os testes passam fakes direto para
// processMetaLead — sem tocar neste arquivo.
// ============================================================

import type { Client } from '@prisma/client';
import { db as prisma } from '@/lib/db';
import { assignLeadToUser, peekNextUser } from '@/lib/lead-queue';
import { notifyQueueUpdate } from '@/lib/telegram';
import { notifyAssignedMetaLead } from '@/lib/lead-notify/service';
import { resolveLeadEnterprise } from '@/lib/lead-notify/resolver';
import { findCapConfigByFormId } from '@/lib/meta-conversions';
import { resolveQueueForMetaLead } from '@/lib/meta-lead-routing';
import { buildLeadTemperatureFields } from '@/lib/lead-temperature';
import { upsertCampaignBindingAuto, fetchEnabledAdAccounts } from '@/lib/meta-ad-accounts';
import type { MetaFieldData, MetaIngestServices } from './pipeline';
import type { DrainAccountRef, DrainAccountResolver, PageTokenResolver } from './inbox';
import { resolvePageToken } from '@/lib/meta-ad-accounts';

/**
 * Busca os dados completos do lead via Graph API (movida verbatim do
 * webhook). O webhook do Meta envia apenas o leadgen_id, sem os
 * field_data — precisamos chamar a API para obter nome, email, etc.
 */
export async function fetchLeadDataFromGraph(leadgenId: string, pageAccessToken: string): Promise<MetaFieldData | null> {
  try {
    const url = `https://graph.facebook.com/v26.0/${leadgenId}?access_token=${encodeURIComponent(pageAccessToken)}&fields=field_data`;
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
 * Resolve a conta de anúncios pelo ID do registro (para o worker da
 * inbox processar depois do webhook responder). Reusa
 * fetchEnabledAdAccounts('webhook') — mesmos campos/parse do webhook.
 */
export const resolveDrainAccountById: DrainAccountResolver = async (adAccountId) => {
  const accounts = await fetchEnabledAdAccounts('webhook');
  const hit = accounts.find((a) => a.id === adAccountId);
  return hit ?? null;
};

/**
 * resolvePageToken real (page token da página tem prioridade sobre o
 * token da conta; fallback: token da conta). Assinatura alinhada ao
 * worker da inbox.
 */
export const resolveDrainPageToken: PageTokenResolver = (account, pageId) =>
  resolvePageToken(account, pageId);

/**
 * Serviços reais do pipeline, amarrados ao PrismaClient da aplicação.
 * A fatia estrutural `MetaIngestDb` é satisfeita pelo PrismaClient
 * (bivariância de métodos) — sem casts.
 */
export function createMetaIngestServices(client: typeof prisma): MetaIngestServices {
  return {
    db: client,
    assignLead: (opts) => assignLeadToUser(opts),
    peekNext: (opts) => peekNextUser(opts),
    notifyAgent: (input) => notifyAssignedMetaLead(input),
    notifyAdminQueue: (chatId, payload) => notifyQueueUpdate(chatId, {
      source: payload.source,
      assignedUserName: payload.assignedUserName,
      nextUserName: payload.nextUserName,
      leadName: payload.leadName,
      enterpriseName: payload.enterpriseName,
    }),
    resolveEnterprise: (input) => resolveLeadEnterprise(input),
    buildTemperature: (formId, rawAnswers) => buildLeadTemperatureFields(formId, rawAnswers),
    findCapConfig: (formId) => findCapConfigByFormId(formId),
    resolveRoute: (input) => resolveQueueForMetaLead(input),
    campaignBindingAuto: (input) => { upsertCampaignBindingAuto(input); },
    fetchLeadData: (leadgenId, pageToken) => fetchLeadDataFromGraph(leadgenId, pageToken),
  };
}

/** Nota: o Client do Prisma é compatível estruturalmente com ClientRecord. */
export type PrismaClientLike = Client;
