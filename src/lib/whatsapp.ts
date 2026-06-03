const Z_API_URL = process.env.Z_API_URL || 'https://api.z-api.io';
const Z_API_INSTANCE = process.env.Z_API_INSTANCE || '';
const Z_API_TOKEN = process.env.Z_API_TOKEN || '';

function isConfigured(): boolean {
  return !!(Z_API_INSTANCE && Z_API_TOKEN);
}

/**
 * Limpa número de telefone brasileiro para formato internacional.
 * Exemplos:
 *   "(11) 99999-9999"  → "5511999999999"
 *   "+55 11 99999-9999" → "5511999999999"
 *   "11999999999"       → "5511999999999"
 */
function cleanPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  // Se já começa com 55 (código Brasil), usar como está
  if (digits.startsWith('55') && digits.length >= 12) {
    return digits;
  }
  // Se tem 11 dígitos (DDD + número), adicionar código Brasil
  if (digits.length === 11) {
    return `55${digits}`;
  }
  // Se tem 10 dígitos (sem 9 no celular), adicionar código Brasil
  if (digits.length === 10) {
    return `55${digits}`;
  }
  // Fallback: retornar como está
  return digits;
}

export async function sendWhatsApp({
  phone,
  message,
}: {
  phone: string;
  message: string;
}): Promise<boolean> {
  if (!isConfigured()) {
    console.log('[WHATSAPP] Z-API não configurada (Z_API_INSTANCE / Z_API_TOKEN) — mensagem não enviada:', phone);
    return false;
  }

  const cleanNumber = cleanPhone(phone);

  try {
    const response = await fetch(
      `${Z_API_URL}/instances/${Z_API_INSTANCE}/token/${Z_API_TOKEN}/send-text`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: cleanNumber,
          message,
        }),
      }
    );

    const data = await response.json();

    if (data.success || data.message === 'Mensagem enviada com sucesso' || response.ok) {
      console.log('[WHATSAPP] Enviado para:', cleanNumber);
      return true;
    } else {
      console.error('[WHATSAPP] Erro na resposta:', data);
      return false;
    }
  } catch (error) {
    console.error('[WHATSAPP] Erro ao enviar:', error);
    return false;
  }
}

// ──── Mensagens pré-formatadas ────────────────────────────────────

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
