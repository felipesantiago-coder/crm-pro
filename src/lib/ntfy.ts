/**
 * Ntfy Notification Service
 *
 * Sends push notifications to CRM users via Ntfy (https://ntfy.sh).
 * Each user has a unique private topic with Basic Auth credentials.
 *
 * Env vars (optional):
 *   NTFY_BASE_URL  — Custom Ntfy server URL (defaults to https://ntfy.sh)
 */

const NTFY_BASE_URL = (process.env.NTFY_BASE_URL || 'https://ntfy.sh').replace(/\/+$/, '');

// ── Types ─────────────────────────────────────────────────────

interface NtfyMessageResponse {
  id?: string;
  time?: number;
  event?: string;
  error?: string;
  code?: number;
}

export interface NtfyLeadData {
  leadName: string;
  leadPhone: string;
  leadEmail: string;
  enterpriseName?: string | null;
  utmCampaign?: string | null;
  utmSource?: string | null;
  slug?: string;
  customAnswers?: Record<string, string> | null;
  /** Base URL of the CRM (for click-to-open link) */
  crmBaseUrl?: string;
}

// ── Core send function ───────────────────────────────────────

async function sendNtfy(
  topic: string,
  token: string,
  payload: {
    topic: string;
    title: string;
    body: string;
    priority?: number;
    tags?: string[];
    click?: string;
    actions?: Array<{
      action: 'view';
      label: string;
      url: string;
      clear?: boolean;
    }>;
  },
): Promise<boolean> {
  try {
    // Basic auth: username = topic, password = token
    const credentials = Buffer.from(`${topic}:${token}`).toString('base64');

    const res = await fetch(`${NTFY_BASE_URL}/${topic}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${credentials}`,
      },
      body: JSON.stringify(payload),
    });

    if (res.status === 200 || res.status === 402) {
      // 200 = success, 402 = tier limit (still delivered in best-effort)
      return true;
    }

    const errorText = await res.text();
    console.error(`[Ntfy] Send failed (${res.status}): ${errorText}`, { topic });
    return false;
  } catch (error) {
    console.error('[Ntfy] Error sending notification:', error);
    return false;
  }
}

// ── Public API ───────────────────────────────────────────────

/**
 * Sends a "new lead" push notification via Ntfy.
 */
export async function notifyNewLead(
  ntfyTopic: string,
  ntfyToken: string,
  data: NtfyLeadData,
): Promise<boolean> {
  const crmBase = (data.crmBaseUrl || process.env.NEXTAUTH_URL || '').replace(/\/+$/, '');

  // Build body text (Ntfy supports markdown)
  let body = '';

  body += `**Nome:** ${data.leadName}\n`;
  if (data.leadPhone) body += `**Telefone:** ${data.leadPhone}\n`;
  if (data.leadEmail) body += `**E-mail:** ${data.leadEmail}\n`;

  if (data.enterpriseName) {
    body += `\n**Empreendimento:** ${data.enterpriseName}\n`;
  }

  if (data.utmCampaign) {
    const source = data.utmSource ? ` (${data.utmSource})` : '';
    body += `**Campanha:** ${data.utmCampaign}${source}\n`;
  }

  // Custom answers block
  if (data.customAnswers && Object.keys(data.customAnswers).length > 0) {
    const lines = Object.entries(data.customAnswers)
      .filter(([, v]) => v && String(v).trim() !== '')
      .map(([k, v]) => `  • **${k}:** ${String(v)}`)
      .join('\n');
    if (lines) {
      body += `\n**Respostas do formulário:**\n${lines}\n`;
    }
  }

  body += `\n_${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}_`;

  // Build click URL (lead page in CRM)
  const leadUrl = crmBase ? `${crmBase}/` : undefined;

  return sendNtfy(ntfyTopic, ntfyToken, {
    topic: ntfyTopic,
    title: '🚨 Novo Lead Recebido!',
    body: body.trim(),
    priority: 5, // high priority
    tags: ['incoming_envelope'],
    click: leadUrl,
    actions: leadUrl
      ? [
          {
            action: 'view' as const,
            label: 'Abrir CRM',
            url: leadUrl,
            clear: true,
          },
        ]
      : undefined,
  });
}

/**
 * Sends a test notification via Ntfy.
 */
export async function sendNtfyTest(
  ntfyTopic: string,
  ntfyToken: string,
  userName: string,
): Promise<boolean> {
  const body =
    `Olá, **${userName}**! 🔔\n\n` +
    `Suas notificações Ntfy estão ativas!\n` +
    `Você receberá alertas aqui sempre que um novo lead for cadastrado via landing page.\n\n` +
    `_${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}_`;

  return sendNtfy(ntfyTopic, ntfyToken, {
    topic: ntfyTopic,
    title: '✅ Notificações Ntfy Ativas!',
    body,
    priority: 3,
    tags: ['white_check_mark'],
  });
}

// ── Helpers ──────────────────────────────────────────────────

/**
 * Generates a unique Ntfy topic name with a CRM prefix.
 */
export function generateNtfyTopic(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let random = '';
  const array = new Uint8Array(8);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(array);
    for (let i = 0; i < 8; i++) {
      random += chars[array[i] % chars.length];
    }
  } else {
    for (let i = 0; i < 8; i++) {
      random += chars[Math.floor(Math.random() * chars.length)];
    }
  }
  return `crm-${random}`;
}

/**
 * Generates a secure access token for Ntfy topic authentication.
 */
export function generateNtfyToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  const array = new Uint8Array(32);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(array);
    for (let i = 0; i < 32; i++) {
      token += chars[array[i] % chars.length];
    }
  } else {
    for (let i = 0; i < 32; i++) {
      token += chars[Math.floor(Math.random() * chars.length)];
    }
  }
  return token;
}