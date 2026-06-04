/**
 * Integração com Meta Cloud API (WhatsApp Business Platform)
 *
 * Substitui a Z-API pela API oficial do WhatsApp Business da Meta.
 * Utiliza template messages para envio de notificações proativas.
 *
 * Variáveis de ambiente necessárias (.env.local):
 *   WHATSAPP_ACCESS_TOKEN       — Token de acesso permanente do System User
 *   WHATSAPP_PHONE_NUMBER_ID    — ID do número de telefone do WhatsApp Business
 *   WHATSAPP_VERSION            — (opcional) Versão da Graph API (default: v21.0)
 *
 * Templates que devem ser criados no Meta Business Manager:
 *   crm_visita_agendada         — Notificação de agendamento criado
 *   crm_lembrete_vencido        — Notificação de lembrete vencido
 *   crm_novo_parceiro           — Notificação de novo parceiro vinculado
 *   crm_nova_observacao         — Notificação de nova observação/interação
 *   crm_visita_proxima          — Lembrete de visita próxima (cron)
 */

const WHATSAPP_ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || '';
const WHATSAPP_PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
const WHATSAPP_VERSION = process.env.WHATSAPP_VERSION || 'v21.0';
const META_API_BASE = `https://graph.facebook.com/${WHATSAPP_VERSION}`;

function isConfigured(): boolean {
  return !!(WHATSAPP_ACCESS_TOKEN && WHATSAPP_PHONE_NUMBER_ID);
}

/**
 * Limpa número de telefone brasileiro para formato internacional.
 * Meta Cloud API exige o formato: 5511999999999 (código país + DDD + número)
 */
function cleanPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  // Se já começa com 55 (código Brasil) e tem pelo menos 12 dígitos
  if (digits.startsWith('55') && digits.length >= 12) {
    return digits;
  }
  // Se tem 11 dígitos (DDD + número celular com 9), adicionar código Brasil
  if (digits.length === 11) {
    return `55${digits}`;
  }
  // Se tem 10 dígitos (DDD + número fixo sem 9), adicionar código Brasil
  if (digits.length === 10) {
    return `55${digits}`;
  }
  // Se já tem código país mas menos de 12 dígitos, usar como está
  if (digits.startsWith('55')) {
    return digits;
  }
  // Fallback
  return digits;
}

/**
 * Formata parâmetro de texto para template message da Meta Cloud API.
 * Converte caracteres especiais para escapar emojis e acentos no formato JSON.
 */
function templateParam(text: string): { type: string; text: string } {
  return { type: 'text', text };
}

/**
 * Envia uma mensagem de template via Meta Cloud API (WhatsApp Business).
 *
 * As template messages são usadas para notificações proativas (fora da janela de 24h).
 * Os templates devem estar previamente aprovados no Meta Business Manager.
 *
 * @returns true se enviada com sucesso, false caso contrário
 */
export async function sendWhatsApp({
  phone,
  message,
  templateName,
  templateParams,
}: {
  phone: string;
  message: string;
  templateName?: string;
  templateParams?: Array<{ type: string; text: string }>;
}): Promise<boolean> {
  if (!isConfigured()) {
    console.log('[WHATSAPP] Meta Cloud API não configurada (WHATSAPP_ACCESS_TOKEN / WHATSAPP_PHONE_NUMBER_ID) — mensagem não enviada:', phone);
    return false;
  }

  const cleanNumber = cleanPhone(phone);

  try {
    // Se templateName e templateParams foram fornecidos, enviar como template
    // Caso contrário, enviar como texto livre (funciona apenas dentro da janela de 24h)
    const body: Record<string, unknown> = {
      messaging_product: 'whatsapp',
      to: cleanNumber,
    };

    if (templateName && templateParams && templateParams.length > 0) {
      // Template message (para notificações proativas)
      body.type = 'template';
      body.template = {
        name: templateName,
        language: { code: 'pt_BR' },
        components: [
          {
            type: 'body',
            parameters: templateParams,
          },
        ],
      };
    } else {
      // Text message (apenas dentro da janela de 24h do cliente)
      body.type = 'text';
      body.text = {
        preview_url: false,
        body: message,
      };
    }

    const response = await fetch(
      `${META_API_BASE}/${WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${WHATSAPP_ACCESS_TOKEN}`,
        },
        body: JSON.stringify(body),
      }
    );

    const data = await response.json();

    if (response.ok) {
      console.log('[WHATSAPP] ✅ Enviado para:', cleanNumber, '| Template:', templateName || 'texto livre');
      return true;
    } else {
      console.error('[WHATSAPP] ❌ Erro na resposta Meta API:', data.error?.message || data);
      return false;
    }
  } catch (error) {
    console.error('[WHATSAPP] Erro ao enviar via Meta Cloud API:', error);
    return false;
  }
}

/**
 * Envia notificação via WhatsApp usando template message da Meta Cloud API.
 * Faz fallback para texto livre se o template falhar.
 */
async function sendWithTemplateFallback(params: {
  phone: string;
  templateName: string;
  templateParams: Array<{ type: string; text: string }>;
  fallbackMessage: string;
}): Promise<boolean> {
  // Tenta enviar como template primeiro
  const success = await sendWhatsApp({
    phone: params.phone,
    message: params.fallbackMessage,
    templateName: params.templateName,
    templateParams: params.templateParams,
  });

  if (success) return true;

  // Fallback: tenta enviar como texto livre (funciona dentro de 24h)
  console.log(`[WHATSAPP] Template "${params.templateName}" falhou, tentando texto livre...`);
  return sendWhatsApp({
    phone: params.phone,
    message: params.fallbackMessage,
  });
}

// ──── Mensagens pré-formatadas (templates + fallback) ────────────────

/**
 * Template: crm_visita_agendada
 * Body: "Uma visita foi agendada para o cliente {{1}} no dia {{2}} às {{3}}, agendado por {{4}}.{{5}}"
 */
export function whatsappScheduleCreated(params: {
  clientName: string;
  scheduledDate: string;
  scheduledTime: string;
  description?: string | null;
  createdBy: string;
}): string {
  const desc = params.description ? `\n📝 Observações: ${params.description}` : '';
  return `📋 *Visita Agendada*\n\n` +
    `👤 Cliente: ${params.clientName}\n` +
    `📅 Data: ${params.scheduledDate}\n` +
    `🕐 Horário: ${params.scheduledTime}\n` +
    `👤 Agendado por: ${params.createdBy}${desc}\n\n` +
    `_CRM Pro_`;
}

export async function sendWhatsAppScheduleCreated(params: {
  phone: string;
  clientName: string;
  scheduledDate: string;
  scheduledTime: string;
  description?: string | null;
  createdBy: string;
}): Promise<boolean> {
  const desc = params.description ? `. ${params.description}` : '';
  return sendWithTemplateFallback({
    phone: params.phone,
    templateName: 'crm_visita_agendada',
    templateParams: [
      templateParam(params.clientName),
      templateParam(params.scheduledDate),
      templateParam(params.scheduledTime),
      templateParam(params.createdBy),
      templateParam(desc),
    ],
    fallbackMessage: whatsappScheduleCreated(params),
  });
}

/**
 * Template: crm_lembrete_vencido
 * Body: "Um lembrete venceu para o cliente {{1}}: {{2}}. Vencimento: {{3}}.{{4}}"
 */
export function whatsappReminderDue(params: {
  clientName: string;
  reminderTitle: string;
  reminderDescription?: string | null;
  dueDate: string;
}): string {
  const desc = params.reminderDescription ? `\n📝 ${params.reminderDescription}` : '';
  return `⏰ *Lembrete Vencido*\n\n` +
    `👤 Cliente: ${params.clientName}\n` +
    `📌 ${params.reminderTitle}${desc}\n` +
    `📅 Vencimento: ${params.dueDate}\n\n` +
    `_CRM Pro_`;
}

export async function sendWhatsAppReminderDue(params: {
  phone: string;
  clientName: string;
  reminderTitle: string;
  reminderDescription?: string | null;
  dueDate: string;
}): Promise<boolean> {
  const desc = params.reminderDescription ? ` ${params.reminderDescription}` : '';
  return sendWithTemplateFallback({
    phone: params.phone,
    templateName: 'crm_lembrete_vencido',
    templateParams: [
      templateParam(params.clientName),
      templateParam(params.reminderTitle),
      templateParam(params.dueDate),
      templateParam(desc),
    ],
    fallbackMessage: whatsappReminderDue(params),
  });
}

/**
 * Template: crm_novo_parceiro
 * Body: "{{1}} foi adicionado como parceiro do cliente {{2}} por {{3}}."
 */
export function whatsappPartnerAdded(params: {
  clientName: string;
  newPartnerName: string;
  addedBy: string;
}): string {
  return `🤝 *Novo Parceiro Vinculado*\n\n` +
    `👤 Cliente: ${params.clientName}\n` +
    `🆕 Parceiro: ${params.newPartnerName}\n` +
    `👤 Adicionado por: ${params.addedBy}\n\n` +
    `_CRM Pro_`;
}

export async function sendWhatsAppPartnerAdded(params: {
  phone: string;
  clientName: string;
  newPartnerName: string;
  addedBy: string;
}): Promise<boolean> {
  return sendWithTemplateFallback({
    phone: params.phone,
    templateName: 'crm_novo_parceiro',
    templateParams: [
      templateParam(params.newPartnerName),
      templateParam(params.clientName),
      templateParam(params.addedBy),
    ],
    fallbackMessage: whatsappPartnerAdded(params),
  });
}

/**
 * Template: crm_nova_observacao
 * Body: "Nova observação registrada no cliente {{1}}: {{2}}"
 */
export function whatsappInteractionAdded(params: {
  clientName: string;
  interactionDescription: string;
}): string {
  const truncated = params.interactionDescription.length > 300
    ? params.interactionDescription.slice(0, 300) + '...'
    : params.interactionDescription;
  return `📝 *Nova Observação*\n\n` +
    `👤 Cliente: ${params.clientName}\n\n` +
    `"${truncated}"\n\n` +
    `_CRM Pro_`;
}

export async function sendWhatsAppInteractionAdded(params: {
  phone: string;
  clientName: string;
  interactionDescription: string;
}): Promise<boolean> {
  const truncated = params.interactionDescription.length > 300
    ? params.interactionDescription.slice(0, 300) + '...'
    : params.interactionDescription;
  return sendWithTemplateFallback({
    phone: params.phone,
    templateName: 'crm_nova_observacao',
    templateParams: [
      templateParam(params.clientName),
      templateParam(truncated),
    ],
    fallbackMessage: whatsappInteractionAdded(params),
  });
}

/**
 * Template: crm_visita_proxima
 * Body: "Lembrete: você tem uma visita agendada hoje às {{1}} para o cliente {{2}}."
 */
export function whatsappScheduleUpcoming(params: {
  clientName: string;
  scheduledDate: string;
  scheduledTime: string;
}): string {
  return `🔔 *Visita Próxima!*\n\n` +
    `👤 Cliente: ${params.clientName}\n` +
    `📅 Hoje às ${params.scheduledTime}\n\n` +
    `Não esqueça da visita agendada!\n\n` +
    `_CRM Pro_`;
}

export async function sendWhatsAppScheduleUpcoming(params: {
  phone: string;
  clientName: string;
  scheduledDate: string;
  scheduledTime: string;
}): Promise<boolean> {
  return sendWithTemplateFallback({
    phone: params.phone,
    templateName: 'crm_visita_proxima',
    templateParams: [
      templateParam(params.scheduledTime),
      templateParam(params.clientName),
    ],
    fallbackMessage: whatsappScheduleUpcoming(params),
  });
}
