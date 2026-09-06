/**
 * Contratos do pipeline de notificação de leads no Telegram.
 *
 * Cinco responsabilidades separadas (ver CRM_Pro_Prompt §8):
 *   1. Ingestão        — rotas Meta/landing montam TelegramLeadNotificationInput
 *   2. Resolução       — resolver.ts determina empreendimento/imagem/origem
 *   3. Apresentação    — humanize.ts constrói TelegramLeadPresentation (puro)
 *   4. Composição      — composer.ts transforma o modelo em partes Telegram (puro)
 *   5. Entrega         — delivery.ts envia com retry/resultado estruturado
 *
 * Nenhum fetch acontece nas camadas 3 e 4 — funções puras, determinísticas
 * e testáveis. Dados pessoais nunca entram em logs, métricas ou callback_data.
 */

// ── Evento ─────────────────────────────────────────────────────

export type TelegramLeadEventKind =
  | 'new_lead'
  | 'returning_lead'
  | 'recovered_lead'
  | 'imported_lead'
  | 'test';

export type TelegramIngestionMethod =
  | 'webhook'
  | 'polling'
  | 'import_by_form'
  | 'manual'
  | 'simulation'
  | 'landing'
  | 'recovery'
  | 'test';

export interface MetaLeadSourceContext {
  /** Id interno da conta de anúncios no CRM (MetaAdAccount.id), se conhecido. */
  adAccountId?: string | null;
  campaignId?: string | null;
  campaignName?: string | null;
  adId?: string | null;
  adName?: string | null;
  formId?: string | null;
  formName?: string | null;
  leadgenId?: string | null;
  ingestionMethod: TelegramIngestionMethod;
  /** Horário REAL do cadastro no Meta (created_time), quando disponível. */
  submittedAt?: Date | null;
  /** Momento em que o CRM recebeu o lead. */
  receivedAt: Date;
}

export interface RawLeadAnswer {
  key: string;
  /** TODOS os valores — múltipla escolha nunca é reduzida ao primeiro. */
  values: string[];
}

export interface TelegramLeadNotificationInput {
  /** leadgenId no Meta; clientId em landing/recuperação; id sintético em teste. */
  eventId: string;
  eventKind: TelegramLeadEventKind;
  clientId?: string | null;
  /** Chat Telegram de destino (verificado na vinculação). */
  recipientChatId: string;
  recipientUserId?: string | null;
  recipientFirstName?: string | null;
  leadName?: string | null;
  leadPhoneE164?: string | null;
  leadEmail?: string | null;
  leadRegion?: string | null;
  /** Empreendimento já conhecido pelo chamador (landing/recuperação/teste). */
  resolvedEnterprise?: ResolvedEnterprise | null;
  source: MetaLeadSourceContext;
  /** Perguntas e respostas do formulário — ordem original preservada. */
  rawAnswers: RawLeadAnswer[];
}

// ── Resolução de empreendimento ────────────────────────────────

export type EnterpriseBindingSource =
  | 'explicit'
  | 'ad_binding'
  | 'form_campaign_mapping'
  | 'campaign_binding'
  | 'form_mapping'
  | 'client'
  | 'none';

export interface ResolvedEnterprise {
  enterpriseId?: string;
  name: string;
  imageUrl?: string;
  imageAlt: string;
  source: EnterpriseBindingSource;
  /** Diagnósticos sem PII (ex.: enterprise_image_missing). */
  diagnostics: string[];
}

// ── Modelo de apresentação ─────────────────────────────────────

export interface HumanizedAnswer {
  key: string;
  label: string;
  displayValue: string;
  order: number;
  /** true quando o valor excedeu o limite e foi exibido parcialmente. */
  truncated?: boolean;
}

export interface LeadPresentationContact {
  name?: string;
  phoneDisplay?: string;
  phoneE164?: string;
  email?: string;
  region?: string;
  hasAny: boolean;
}

export interface LeadPresentationEnterprise {
  id?: string;
  name: string;
  imageUrl?: string;
  imageAlt: string;
}

export interface LeadSourceSummary {
  channelLabel: string;
  campaign?: string;
  ad?: string;
  form?: string;
}

export interface TelegramLeadPresentation {
  title: string;
  /** Abertura personalizada com o atendente — já finalizada. */
  intro: string;
  eventLabel: string;
  contact: LeadPresentationContact;
  enterprise: LeadPresentationEnterprise | null;
  answers: HumanizedAnswer[];
  sourceSummary: LeadSourceSummary;
  submittedAt?: Date;
  receivedAt: Date;
  crmUrl?: string;
  whatsappUrl?: string;
  whatsappGreeting?: string;
  /** Limitações aplicadas na apresentação (auditoria, sem PII). */
  limitations: string[];
}

// ── Composição Telegram ────────────────────────────────────────

export interface TelegramInlineKeyboard {
  rows: Array<Array<{ text: string; url: string }>>;
}

export type TelegramImageSource = { kind: 'url'; url: string };

export type TelegramOutboundPart =
  | {
      kind: 'photo';
      image: TelegramImageSource;
      caption: string;
      parseMode: 'HTML';
      replyMarkup?: TelegramInlineKeyboard;
    }
  | {
      kind: 'text';
      text: string;
      parseMode: 'HTML';
      /** Encadeia esta parte como resposta da anterior (conjunto unido). */
      replyToPrevious: boolean;
      replyMarkup?: TelegramInlineKeyboard;
    };

export interface TelegramDeliveryResult {
  ok: boolean;
  status: 'delivered' | 'partial' | 'failed' | 'skipped_duplicate';
  messages: Array<{
    kind: 'photo' | 'text';
    messageId?: number;
    delivered: boolean;
    errorCode?: string;
  }>;
  attempts: number;
}
