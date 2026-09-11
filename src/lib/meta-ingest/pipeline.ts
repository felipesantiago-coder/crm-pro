// ============================================================
// META LEAD INGEST PIPELINE — processamento idempotente de um lead
// ============================================================
// Fase 3 da otimização Vercel (ingestão durável): EXTRAÇÃO VERBATIM
// do processamento por-lead que antes vivia duplicado dentro do
// webhook (src/app/api/webhooks/meta-leads/route.ts) e do polling
// (src/app/api/cron/fetch-meta-leads/route.ts). A partir de agora
// webhook, polling e o worker de retry (inbox) compartilham UMA
// implementação — leads de fontes diferentes nunca se misturam e o
// comportamento observável de cada canal é preservado byte a byte:
//
//   - webhook: dedup telefone/email PRIMEIRO (cartão returning_lead),
//     depois metaLeadgenId; upsert de LeadFormMapping; CAPI por form
//     + fallback da conta; textos "[Meta Ads]"; LostLead quando a
//     conta está sem token e o payload veio sem field_data; erro de
//     criação vira resultado create_failed (não propaga).
//   - polling: dedup metaLeadgenId PRIMEIRO (já_existente, sem
//     interação), depois telefone/email (cliente_existente_atualizado
//     SEM notificação e SEM fila); sem upsert de LeadFormMapping;
//     textos "[Meta Polling]"; nota extra "Criado em"; empreendimento
//     resolvido (com clientId) antes do cartão; erro de criação
//     PROPAGA (contrato atual — vira erro por lead no run).
//
// Injeção de dependências: `db` é uma fatia estrutural do
// PrismaClient e todos os serviços externos (fila, Telegram,
// temperatura, Graph API) chegam por `MetaIngestServices` — o módulo
// NÃO importa @/lib/db em runtime (apenas tipos), permitindo teste
// com fakes (padrão lead-form-removal.ts). Os defaults reais ficam
// em defaults.ts.
// ============================================================

import crypto from 'crypto';
import type { RawLeadAnswer } from '@/lib/meta-lead-utils';
import {
  getMetaFieldValue,
  formatMetaPhone,
  extractCustomAnswers,
  extractRawAnswers,
  formatCustomAnswersText,
} from '@/lib/meta-lead-utils';
import type { AssignResult } from '@/lib/lead-queue';
import type { MetaLeadRouteInput, ResolvedLeadRoute } from '@/lib/meta-lead-routing';
import type { TelegramLeadNotificationInput, TelegramDeliveryResult } from '@/lib/lead-notify/types';

/** Contexto de empreendimento resolvido (tipo real, apagado em runtime). */
type EnterpriseContext = Awaited<
  ReturnType<typeof import('@/lib/lead-notify/resolver').resolveLeadEnterprise>
>;

// ── Tipos básicos ───────────────────────────────────────────────

/** Par nome/valores de um campo do formulário Meta (field_data). */
export type MetaFieldData = Array<{ name: string; values: string[] }>;

/** Canal de ingestão — determina textos, ordem de dedup e notificações. */
export type MetaIngestChannel = 'webhook' | 'polling';

/** Campos de temperatura produzidos por buildLeadTemperatureFields. */
export type TemperatureFields = Partial<{
  metaFormId: string;
  metaFormData: string;
  metaScore: number;
  metaTemperature: string;
}>;

/** Cliente mínimo necessário no processamento (retorno de findFirst/create). */
export interface ClientRecord {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
}

// ── Fatia estrutural do PrismaClient usada pelo pipeline ────────
// Sintaxe de MÉTODO (não arrow property) mantém a bivariância de
// parâmetros do TypeScript: o PrismaClient real satisfaz esta
// interface e os testes implementam exatamente os mesmos formatos.

export interface MetaIngestDb {
  client: {
    findUnique(args: {
      where: { metaLeadgenId: string };
      select: { id: true; name?: true };
    }): Promise<{ id: string; name?: string } | null>;
    findFirst(args: {
      where: { OR?: Array<{ phone: string } | { email: string }> } | { phone: string } | { email: string };
      orderBy: { createdAt: 'desc' };
    }): Promise<ClientRecord | null>;
    update(args: {
      where: { id: string };
      data: {
        lastInteractionAt?: Date;
        phone?: string;
        metaLeadgenId?: string;
        createdBy?: string;
        utmSource?: string;
        utmCampaign?: string;
      };
    }): Promise<unknown>;
    create(args: {
      data: {
        name: string;
        email?: string | undefined;
        phone?: string | undefined;
        region?: string | undefined;
        stage: string;
        updatePeriod: number;
        createdBy: string;
        metaLeadgenId: string;
        metaCapConfigId?: string | undefined;
        notes: string;
      } & TemperatureFields;
    }): Promise<ClientRecord>;
  };
  interaction: {
    create(args: { data: { clientId: string; description: string } }): Promise<unknown>;
  };
  user: {
    findUnique(args: {
      where: { id: string };
      select: { telegramChatId: true; name: true };
    }): Promise<{ telegramChatId: string | null; name: string } | null>;
    findFirst(args: {
      where: { role: string };
      select: { telegramChatId: true };
    }): Promise<{ telegramChatId: string | null } | null>;
  };
  metaCapConfig: {
    findFirst(args: {
      where: { adAccountId: string; enabled: boolean };
      select: { id: true };
      orderBy: Array<Record<string, string>>;
    }): Promise<{ id: string } | null>;
  };
  leadFormMapping: {
    upsert(args: {
      where: { formId_campaignId: { formId: string; campaignId: string } };
      create: {
        formId: string;
        formName: string | null;
        adId: string | null;
        adName: string | null;
        campaignId: string | null;
        campaignName: string | null;
        adAccountId: string | null;
      };
      update: {
        leadCount: { increment: number };
        formName?: string;
        adName?: string;
        adAccountId?: string;
      };
    }): Promise<unknown>;
  };
  lostLead: {
    create(args: {
      data: {
        source: string;
        name: string;
        formData: {
          reason: string;
          adAccountId: string | null;
          leadgenId: string;
          campaignId: string | null;
          formId: string | null;
          timestamp: string;
        };
      };
    }): Promise<unknown>;
  };
}

// ── Serviços externos injetáveis (defaults reais em defaults.ts) ─

export interface MetaIngestServices {
  db: MetaIngestDb;
  assignLead(opts: { leadId?: string; queueId?: string; source?: string }): Promise<AssignResult>;
  peekNext(opts: { queueId?: string }): Promise<{ userName?: string | null } | null>;
  notifyAgent(input: TelegramLeadNotificationInput): Promise<TelegramDeliveryResult>;
  notifyAdminQueue(
    chatId: string,
    payload: {
      source: string;
      assignedUserName: string;
      nextUserName: string | null;
      leadName: string;
      enterpriseName?: string;
    },
  ): Promise<unknown>;
  resolveEnterprise(input: {
    adId: string | null;
    formId: string | null;
    campaignId: string | null;
    clientId?: string | null;
  }): Promise<EnterpriseContext | null>;
  buildTemperature(formId: string | null | undefined, rawAnswers: RawLeadAnswer[]): Promise<TemperatureFields>;
  findCapConfig(formId: string): Promise<{ id: string } | null>;
  resolveRoute(input: MetaLeadRouteInput): Promise<ResolvedLeadRoute>;
  campaignBindingAuto(input: { campaignId: string; campaignName?: string | null; adAccountId?: string | null }): void;
  fetchLeadData(leadgenId: string, pageToken: string): Promise<MetaFieldData | null>;
}

// ── Entrada do pipeline ─────────────────────────────────────────

export interface MetaLeadPipelineInput {
  channel: MetaIngestChannel;
  leadgenId: string;
  /** field_data do webhook ou do polling (pode vir vazio). */
  fieldData: MetaFieldData;
  /** created_time cru: webhook = unix (segundos); polling = ISO string. */
  createdTimeRaw?: number | string | null;
  /** ad_name cru — default por canal ('Anúncio Meta Ads' / 'Meta Ads'). */
  rawAdName?: string | null;
  rawAdId?: string | null;
  campaignId?: string | null;
  campaignName?: string | null;
  formId?: string | null;
  formName?: string | null;
  /** ID do registro MetaAdAccount (para CAPI/LostLead/logs). */
  adAccountDbId: string | null;
  /** Nome da conta para LostLead/logs. */
  adAccountName: string;
  /** Webhook: page token resolvido para buscar field_data (se necessário). */
  pageToken?: string | null;
  creatorId?: string;
  reqId?: string;
  /** Polling: rota resolvida UMA vez por alvo (não re-resolve por lead). */
  preResolvedRoute?: ResolvedLeadRoute;
}

// ── Resultado normalizado ───────────────────────────────────────

export type MetaLeadOutcome = {
  leadgenId: string;
  /** Criou cliente novo (import real). */
  imported: boolean;
  /** Lead já conhecido (dedup) — tratado, nada criado. */
  deduped: boolean;
  /** imported || deduped — mapeia para o `success` do webhook. */
  success: boolean;
  clientName?: string;
  reason?: string;
  assignedTo?: string;
  clientId?: string;
};

// ── Validação HMAC (movida verbatim do webhook) ─────────────────

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
export function isValidSignature(payload: string, signature: string | null, appSecret: string): boolean {
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

// ── Dedup por contato (movida verbatim do webhook) ──────────────

/**
 * Verifica se um cliente já existe com o mesmo telefone ou email
 * para evitar duplicatas de leads do mesmo anúncio.
 */
async function findExistingClient(db: MetaIngestDb, phone: string | null, email: string | null): Promise<ClientRecord | null> {
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

// ── Pipeline principal ──────────────────────────────────────────

/**
 * Processa UM lead Meta por completo (extração, dedup, cliente,
 * interação, temperatura, fila, notificações) preservando o
 * comportamento EXATO do canal de origem.
 *
 * Erros de criação: no webhook viram resultado `create_failed`
 * (contrato atual); no polling PROPAGAM (contrato atual — viram
 * erro por lead no run). Demais erros sempre propagam para o
 * chamador (webhook: processing_error; inbox: RETRYABLE/FAILED).
 */
export async function processMetaLead(
  services: MetaIngestServices,
  input: MetaLeadPipelineInput,
): Promise<MetaLeadOutcome> {
  const db = services.db;
  const isWebhook = input.channel === 'webhook';

  const leadgenId = input.leadgenId;
  // Leads de simulação (SIM_*) são prévias — o cartão nunca parece um lead real (§15)
  const isSimulation = isWebhook && leadgenId.startsWith('SIM_');
  const reqId = input.reqId ? `[${input.reqId}]` : '';
  const logTag = isWebhook ? `[Meta Webhook]${reqId}` : '[Meta Polling]';

  // Horário REAL do cadastro no Meta:
  //   webhook  = unix em segundos (value.created_time)
  //   polling  = ISO string do endpoint /leads
  const submittedAt: Date | null = isWebhook
    ? (typeof input.createdTimeRaw === 'number' && input.createdTimeRaw > 0
        ? new Date(input.createdTimeRaw * 1000)
        : null)
    : (input.createdTimeRaw ? new Date(input.createdTimeRaw) : null);

  const adName = input.rawAdName || (isWebhook ? 'Anúncio Meta Ads' : 'Meta Ads');
  const campaignName = input.campaignName || '';
  const formName = input.formName || '';
  const formId = input.formId || '';
  const adId = String(input.rawAdId || '');
  const campaignId = String(input.campaignId || '');
  const adAccountId = input.adAccountDbId;

  console.log(`${logTag} Processando leadgen_id=${leadgenId}, formId=${formId}, ad="${adName}", campaign="${campaignName}"${campaignId ? ` (id=${campaignId})` : ''}`);

  // Auto-registro do vínculo campanha → conta (fire-and-forget):
  // permite fila ESPECÍFICA por campanha (MetaCampaignBinding) e
  // gestão independente das campanhas de cada conta.
  if (campaignId) {
    services.campaignBindingAuto({ campaignId, campaignName, adAccountId });
  }

  // Auto-populate lead_form_mappings (fire-and-forget, non-critical) —
  // SOMENTE webhook (o polling nunca alimentou este mapeamento por lead).
  if (isWebhook && formId) {
    db.leadFormMapping.upsert({
      where: { formId_campaignId: { formId, campaignId: campaignId || '__no_campaign' } },
      create: {
        formId,
        formName: formName || null,
        adId: adId || null,
        adName: adName !== 'Anúncio Meta Ads' ? adName : null,
        campaignId: campaignId || null,
        campaignName: campaignName || null,
        adAccountId: adAccountId || null,
      },
      update: {
        leadCount: { increment: 1 },
        formName: formName || undefined,
        adName: adName !== 'Anúncio Meta Ads' ? adName : undefined,
        adAccountId: adAccountId || undefined,
      },
    }).catch((err: unknown) => {
      console.warn(`[Meta Webhook] Falha ao upsert form mapping ${formId}:`, err instanceof Error ? err.message : err);
    });
  }

  // Buscar CAPI config por form_id (para multi-client CAPI).
  // MULTI-CONTA: se o form não está mapeado, usa um config CAPI
  // pertencente à conta de origem (dataset correto por conta).
  // O polling resolve APENAS por form (comportamento atual).
  let capiConfigId: string | undefined;
  if (formId) {
    try {
      const capiMatch = await services.findCapConfig(formId);
      if (capiMatch) {
        capiConfigId = capiMatch.id;
      }
    } catch (capiErr) {
      console.warn(`${logTag} Falha ao buscar CAPI config para form ${formId}:`, capiErr);
    }
  }
  if (isWebhook && !capiConfigId && adAccountId) {
    try {
      const accConfig = await db.metaCapConfig.findFirst({
        where: { adAccountId, enabled: true },
        select: { id: true },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
      });
      if (accConfig) {
        capiConfigId = accConfig.id;
        console.log(`[Meta Webhook] CAPI config ${accConfig.id} resolvido pela conta "${input.adAccountName}" (${adAccountId})`);
      }
    } catch (err) {
      console.warn('[Meta Webhook] Falha ao buscar CAPI config da conta (migration pendente?):', err instanceof Error ? err.message : err);
    }
  }

  // ROTEAMENTO MULTI-ANÚNCIO/MULTI-CONTA: prioridade
  // campanha (campaignId) > formulário (formId) > conta >
  // config CAPI > fila default. Sem vínculo → fila default.
  // Polling: rota pré-resolvida por alvo (uma resolução por formulário).
  const route: ResolvedLeadRoute = input.preResolvedRoute ?? await services.resolveRoute({
    formId,
    campaignId: campaignId || undefined,
    capiConfigId,
    adAccountId: adAccountId || undefined,
  });
  if (route.routeSource !== 'default') {
    console.log(`${logTag} Fila roteada para lead ${leadgenId}: "${route.queueName ?? route.queueId}" (${route.routeSource})`);
  }

  // Webhook: o Meta envia apenas o ID — buscar dados via Graph API
  // quando o payload veio sem field_data. MULTI-CONTA: usa
  // EXCLUSIVAMENTE o PAGE TOKEN da conta resolvida pela página
  // (não existe token global). Conta sem token + payload sem
  // field_data → lead salvo como perdido.
  // Polling: field_data já vem do endpoint /leads (nunca busca aqui).
  let fieldData = input.fieldData;
  if (isWebhook && fieldData.length === 0 && input.pageToken) {
    console.log(`[Meta Webhook] Buscando dados do lead ${leadgenId} via Graph API (field_data vazio no webhook, token da conta "${input.adAccountName}")`);
    const fetched = await services.fetchLeadData(leadgenId, input.pageToken);
    if (fetched) {
      fieldData = fetched;
    } else {
      console.error(`[Meta Webhook] ⚠ Não foi possível buscar dados do lead ${leadgenId} via Graph API — lead será criado com dados mínimos`);
    }
  } else if (isWebhook && fieldData.length === 0 && !input.pageToken) {
    console.error(`[Meta Webhook] ⚠ Sem field_data e a conta "${input.adAccountName}" está sem access token — lead ${leadgenId} salvo como perdido`);
    try {
      await db.lostLead.create({
        data: {
          source: 'meta_webhook_no_account_token',
          name: `Conta "${input.adAccountName}" sem token — lead ${leadgenId} (form ${formId || '?'})`,
          formData: {
            reason: 'conta_sem_access_token',
            adAccountId,
            leadgenId,
            campaignId: campaignId || null,
            formId: formId || null,
            timestamp: new Date().toISOString(),
          },
        },
      });
    } catch {}
    return { leadgenId, imported: false, deduped: false, success: false, clientName: 'Lead Meta Ads', reason: 'no_account_token' };
  } else if (isWebhook) {
    console.log(`[Meta Webhook] field_data presente no webhook com ${fieldData.length} campos para lead ${leadgenId}`);
  } else if (fieldData.length > 0) {
    console.log(`${logTag} field_data presente com ${fieldData.length} campos para lead ${leadgenId}`);
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
  // Todas as respostas, com todos os valores e ordem original —
  // matéria-prima do cartão de notificação
  const rawAnswers = extractRawAnswers(fieldData);

  // TEMPERATURA DO LEAD (por formulário): soma as notas das respostas
  // com a config DO PRÓPRIO formulário (Anúncios Meta > Temperatura) e
  // classifica frio/morno/quente pelo limiar dele. Grava metaFormId/
  // metaFormData SEMPRE (permite configurar depois + reclassificar);
  // metaScore/metaTemperature somente com config ativa.
  const temperatureFields = await services.buildTemperature(formId || undefined, rawAnswers);

  // Resolução do empreendimento pela precedência de vínculos EXPLÍCITOS
  // (anúncio > form+campanha > campanha > formulário > cliente) — nunca
  // por similaridade de nome. WEBHOOK: lazy, sem clientId, compartilhada
  // entre os avisos do admin. POLLING: resolvida com clientId na hora do
  // cartão (comportamentos originais preservados).
  let webhookEntPromise: Promise<EnterpriseContext | null> | null = null;
  const getWebhookEnterprise = () => {
    webhookEntPromise ??= services.resolveEnterprise({
      adId: adId || null,
      formId: formId || null,
      campaignId: campaignId || null,
    });
    return webhookEntPromise;
  };

  console.log(`${logTag} Dados extraídos: name="${name}", email=${email || 'null'}, phone=${phone || 'null'}, city=${region || 'null'}`);

  // ── DEDUP (ordem distinta por canal — contrato atual) ──────────
  //   webhook: telefone/email PRIMEIRO, metaLeadgenId depois
  //   polling: metaLeadgenId PRIMEIRO, telefone/email depois
  if (isWebhook) {
    // 7. Verificar duplicata por telefone/email
    const existing = await findExistingClient(db, phone, email);
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

      // Assign via queue even for existing clients — na fila do
      // formulário de origem deste lead (não da origem antiga)
      try {
        const assignResult = await services.assignLead({
          leadId: existing.id,
          queueId: route.queueId,
          source: `meta_ads:${(campaignName || adName || '').slice(0, 200)}`,
        });
        if (assignResult.assigned && assignResult.userId) {
          assignedUserName = assignResult.userName;
          console.log(`[Meta Webhook] Fila: lead existente ${existing.id} atribuído a "${assignResult.userName}" (fila=${assignResult.queueId})`);
          await db.client.update({
            where: { id: existing.id },
            data: { createdBy: assignResult.userId },
          }).catch(() => {});
          // Send Telegram notification to assigned agent (await — serverless-safe)
          try {
            const agentUser = await db.user.findUnique({ where: { id: assignResult.userId }, select: { telegramChatId: true, name: true } });
            if (agentUser?.telegramChatId) {
              console.log(`[Meta Webhook]${reqId} Enviando cartão de lead para "${agentUser.name}" (lead existente ${existing.id})`);
              await services.notifyAgent({
                eventId: leadgenId,
                eventKind: isSimulation ? 'test' : 'returning_lead',
                clientId: existing.id,
                recipientChatId: agentUser.telegramChatId,
                recipientUserId: assignResult.userId,
                recipientFirstName: assignResult.userName || null,
                leadName: existing.name,
                leadPhoneE164: phone || existing.phone || null,
                leadEmail: email || existing.email || null,
                leadRegion: region,
                source: {
                  adAccountId: adAccountId || null,
                  campaignId: campaignId || null,
                  campaignName: campaignName || null,
                  adId: adId || null,
                  adName: adName || null,
                  formId: formId || null,
                  formName: formName || null,
                  leadgenId,
                  ingestionMethod: isSimulation ? 'simulation' : 'webhook',
                  submittedAt,
                  receivedAt: new Date(),
                },
                rawAnswers,
              });
              console.log(`[Meta Webhook]${reqId} ✅ Cartão de lead enviado para "${agentUser.name}"`);
            } else {
              console.warn(`[Meta Webhook]${reqId} Usuário ${agentUser?.name || assignResult.userId} sem Telegram configurado. Lead existente ${existing.id} sem notificação.`);
            }
          } catch (notifyErr) {
            console.warn(`[Meta Webhook]${reqId} Falha na notificação do agente (lead existente):`, notifyErr);
          }

          // Notify admin about queue rotation (await — serverless-safe)
          if (assignResult.message !== 'already_assigned') {
            try {
              const admin = await db.user.findFirst({ where: { role: 'ADMIN' }, select: { telegramChatId: true } });
              if (admin?.telegramChatId) {
                const nextUser = await services.peekNext({ queueId: assignResult.queueId });
                console.log(`[Meta Webhook]${reqId} Enviando notificação de fila ao admin`);
                await services.notifyAdminQueue(admin.telegramChatId, {
                  source: `meta_ads:${(campaignName || adName || '').slice(0, 200)}`,
                  assignedUserName: assignResult.userName || 'Desconhecido',
                  nextUserName: nextUser?.userName || null,
                  leadName: existing.name,
                  enterpriseName: (await getWebhookEnterprise())?.name || undefined,
                });
                console.log(`[Meta Webhook]${reqId} ✅ Notificação de fila enviada ao admin`);
              } else {
                console.warn(`[Meta Webhook]${reqId} Admin sem Telegram configurado — notificação de fila pulada`);
              }
            } catch (err) {
              console.warn(`[Meta Webhook]${reqId} Admin queue notification failed (existing):`, err instanceof Error ? err.message : err);
            }
          }
        } else {
          console.warn(`[Meta Webhook] ⚠ Fila: não foi possível atribuir lead existente ${existing.id}: ${assignResult.message}`);
        }
      } catch (queueErr) {
        console.error(`[Meta Webhook] ⚠ Falha na atribuição de fila (lead existente ${existing.id}):`, queueErr);
      }

      return {
        leadgenId,
        imported: false,
        deduped: true,
        success: true,
        clientName: existing.name,
        reason: 'duplicate_added_interaction',
        clientId: existing.id,
        assignedTo: assignedUserName,
      };
    }

    // 7b. Check for duplicate — dedicated metaLeadgenId column (O(1) indexed lookup)
    try {
      const existingByLeadgenId = await db.client.findUnique({
        where: { metaLeadgenId: leadgenId },
        select: { id: true },
      });
      if (existingByLeadgenId) {
        console.log(`[Meta Webhook] Lead ${leadgenId} já processado anteriormente (client ${existingByLeadgenId.id}) — ignorando`);
        return { leadgenId, imported: false, deduped: true, success: true, clientName: 'dedup', reason: 'already_processed', clientId: existingByLeadgenId.id };
      }
    } catch (dedupErr) {
      console.warn(`[Meta Webhook] Falha na verificação de duplicata para lead ${leadgenId}:`, dedupErr);
    }
  } else {
    // POLLING — 1. Dedup por metaLeadgenId (sem interação, sem fila)
    const existing = await db.client.findUnique({ where: { metaLeadgenId: leadgenId }, select: { id: true, name: true } });
    if (existing) {
      return { leadgenId, imported: false, deduped: true, success: true, clientName: existing.name, reason: 'já_existente', clientId: existing.id };
    }
  }

  // 8. Validar creatorId (resolvido uma vez pelo chamador)
  if (!input.creatorId) {
    console.error(`${logTag} ⚠ NENHUM USUÁRIO NO SISTEMA — Lead "${name}" (${leadgenId}) PERDIDO!`);
    return { leadgenId, imported: false, deduped: false, success: false, clientName: name, reason: 'no_user' };
  }
  const creatorId = input.creatorId;

  // POLLING — 3. Dedup por telefone/email (soft): atualiza e registra
  // interação, SEM atribuição de fila e SEM notificação (contrato atual).
  if (!isWebhook) {
    const existingByContact = await findExistingClient(db, phone, email);
    if (existingByContact) {
      await db.client.update({ where: { id: existingByContact.id }, data: { metaLeadgenId: leadgenId, lastInteractionAt: new Date() } }).catch(() => {});
      await db.interaction.create({ data: { clientId: existingByContact.id, description: `[Meta Polling] Lead ${leadgenId} detectado pelo polling. Dados: ${email ? `Email: ${email}` : ''}${phone ? ` | Tel: ${phone}` : ''}.${customAnswersText}` } });
      return { leadgenId, imported: false, deduped: true, success: true, clientName: existingByContact.name, reason: 'cliente_existente_atualizado', clientId: existingByContact.id };
    }
  }

  // 9. Criar cliente (nota e interação com texto EXATO do canal)
  const notes = isWebhook
    ? `[Meta Ads] Lead recebido automaticamente.\nAnúncio: ${adName}${campaignName ? `\nCampanha: ${campaignName}` : ''}\nFormulário: ${formName}${formId ? ` (ID: ${formId})` : ''}\nLead ID: ${leadgenId}${capiConfigId ? `\nCAPI Config: ${capiConfigId}` : ''}${customAnswersText}`
    : `[Meta Ads] Lead importado por polling automático.\nAnúncio: ${adName}${campaignName ? `\nCampanha: ${campaignName}` : ''}\nFormulário: ${formName}${formId ? ` (ID: ${formId})` : ''}\nLead ID: ${leadgenId}${input.createdTimeRaw ? `\nCriado em: ${String(input.createdTimeRaw)}` : ''}${capiConfigId ? `\nCAPI Config: ${capiConfigId}` : ''}${customAnswersText}`;

  let newClient: ClientRecord;
  try {
    newClient = await db.client.create({
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
        ...temperatureFields,
        notes,
      },
    });
  } catch (createError) {
    if (isWebhook) {
      console.error(`[Meta Webhook] ⚠ Erro ao criar cliente "${name}" (${leadgenId}):`, createError);
      return { leadgenId, imported: false, deduped: false, success: false, clientName: name, reason: 'create_failed' };
    }
    // Polling: propaga (contrato atual — erro por lead no run)
    throw createError;
  }
  console.log(`${logTag} ✅ Cliente criado: id=${newClient.id}, name="${name}", phone=${phone || 'null'}, email=${email || 'null'}`);

  // Create initial interaction
  await db.interaction.create({
    data: {
      clientId: newClient.id,
      description: isWebhook
        ? `[Meta Ads] Cliente criado automaticamente via lead do anúncio "${adName}"${campaignName ? ` (campanha: ${campaignName})` : ''}. Origem: Facebook/Instagram Lead Ads.${customAnswersText}`
        : `[Meta Polling] Cliente criado via polling automático. Anúncio: ${adName}.${customAnswersText}`,
    },
  });

  // 10. Assign via queue — na fila roteada pela origem do lead
  let assignedUserId: string | undefined;
  let assignedQueueId: string | undefined;
  let assignedUserName: string | undefined;
  try {
    const assignResult = await services.assignLead({
      leadId: newClient.id,
      queueId: route.queueId,
      source: isWebhook
        ? `meta_ads:${(campaignName || adName || '').slice(0, 200)}`
        : `meta_ads:polling:${campaignName || adName || ''}`,
    });
    if (assignResult.assigned && assignResult.userId) {
      assignedUserId = assignResult.userId;
      assignedQueueId = assignResult.queueId;
      assignedUserName = assignResult.userName;
      console.log(`${logTag} ✅ Fila: client ${newClient.id} atribuído a "${assignResult.userName}" (userId=${assignResult.userId}, fila=${assignResult.queueId})`);
      await db.client.update({
        where: { id: newClient.id },
        data: {
          createdBy: assignedUserId,
          utmSource: 'meta_ads',
          utmCampaign: (campaignName || '').slice(0, 200) || undefined,
        },
      }).catch(() => {});
    } else {
      console.warn(`${logTag} ⚠ Fila: não foi possível atribuir client ${newClient.id}: ${assignResult.message}`);
    }
  } catch (queueErr) {
    console.error(`${logTag} ⚠ Falha na atribuição de fila (client ${newClient.id}):`, queueErr);
  }

  // 11. Send Telegram notification to assigned agent (await — serverless-safe).
  // Empreendimento vem EXCLUSIVAMENTE dos vínculos explícitos — nunca por
  // similaridade de nome de anúncio (§9.1). POLLING resolve (com clientId)
  // antes do cartão; WEBHOOK não inclui empreendimento no cartão (contrato).
  const notifyId = assignedUserId || creatorId;
  let resolvedEnt: EnterpriseContext | null = null;
  if (notifyId) {
    try {
      const agentUser = await db.user.findUnique({ where: { id: notifyId }, select: { telegramChatId: true, name: true } });
      if (agentUser?.telegramChatId) {
        if (!isWebhook) {
          resolvedEnt = await services.resolveEnterprise({
            adId: adId || null,
            formId: formId || null,
            campaignId: campaignId || null,
            clientId: newClient.id,
          });
        }
        console.log(`${logTag} Enviando cartão de lead para "${agentUser.name}" (client ${newClient.id})`);
        await services.notifyAgent({
          eventId: leadgenId,
          eventKind: isWebhook ? (isSimulation ? 'test' : 'new_lead') : 'new_lead',
          clientId: newClient.id,
          recipientChatId: agentUser.telegramChatId,
          recipientUserId: notifyId,
          recipientFirstName: assignedUserName || null,
          leadName: newClient.name,
          leadPhoneE164: newClient.phone || null,
          leadEmail: newClient.email || null,
          leadRegion: region,
          resolvedEnterprise: isWebhook ? undefined : resolvedEnt,
          source: {
            adAccountId: adAccountId || null,
            campaignId: campaignId || null,
            campaignName: campaignName || null,
            adId: adId || null,
            adName: adName || null,
            formId: formId || null,
            formName: formName || null,
            leadgenId,
            ingestionMethod: isWebhook ? (isSimulation ? 'simulation' : 'webhook') : 'polling',
            submittedAt,
            receivedAt: new Date(),
          },
          rawAnswers,
        });
        console.log(`${logTag} ✅ Cartão de lead enviado para "${agentUser.name}"`);
      } else {
        console.warn(`${logTag} Usuário ${agentUser?.name || notifyId} atribuído mas sem Telegram. Lead ${newClient.id} (${name}) sem notificação.`);
      }
    } catch (notifyErr) {
      console.warn(`${logTag} Falha na notificação do agente (client ${newClient.id}):`, notifyErr);
    }
  }

  // 12. Notify admin about queue rotation (await — serverless-safe)
  if (assignedUserId && assignedQueueId) {
    try {
      const admin = await db.user.findFirst({ where: { role: 'ADMIN' }, select: { telegramChatId: true } });
      if (admin?.telegramChatId) {
        const nextUser = await services.peekNext({ queueId: assignedQueueId });
        console.log(`${logTag} Enviando notificação de fila ao admin`);
        await services.notifyAdminQueue(admin.telegramChatId, {
          source: isWebhook
            ? `meta_ads:${(campaignName || adName || '').slice(0, 200)}`
            : `meta_ads:polling:${campaignName || adName || ''}`,
          assignedUserName: isWebhook ? (assignedUserName || 'Desconhecido') : (assignedUserName || '?'),
          nextUserName: nextUser?.userName || null,
          leadName: newClient.name,
          enterpriseName: isWebhook
            ? ((await getWebhookEnterprise())?.name || undefined)
            : (resolvedEnt?.name || undefined),
        });
        console.log(`${logTag} ✅ Notificação de fila enviada ao admin`);
      } else {
        console.warn(`${logTag} Admin sem Telegram configurado — notificação de fila pulada`);
      }
    } catch (err) {
      console.warn(`${logTag} Admin queue notification failed (new):`, err instanceof Error ? err.message : err);
    }
  }

  return {
    leadgenId,
    imported: true,
    deduped: false,
    success: true,
    clientName: name,
    clientId: newClient.id,
    assignedTo: assignedUserName,
  };
}
