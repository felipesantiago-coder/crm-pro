// ============================================================
// Meta Conversions API (CAPI) — Server-Side Event Relay
//
// Envia eventos de conversão diretamente para a Meta (server-side),
// ignorando ad blockers. Complemento do Pixel no browser.
//
// SECURITY: esta lógica vivia na rota pública POST /api/meta-capi,
// cujo "gate" de origin era inefetivo (curl sem Origin passava) e
// permitia injeção de conversões falsas no pixel. A lógica agora é
// uma função de lib importada exclusivamente por código server-side
// (public-lead) — a superfície HTTP pública foi removida.
//
// Required env vars:
//   META_PIXEL_ID      — Facebook Pixel ID
//   META_ACCESS_TOKEN  — System User Token com ads_management
// ============================================================

const META_API_VERSION = 'v26.0';
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;

// SHA-256 hash for PII (Meta CAPI requirement)
async function sha256(str: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(str.trim().toLowerCase());
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface MetaCapiRelayUserData {
  email?: string;
  phone?: string;
  name?: string;
  ip?: string;
  user_agent?: string;
  fbp?: string;
  fbc?: string;
  page_url?: string;
}

export interface MetaCapiRelayEvent {
  event_name: string;
  event_id?: string;
  user_data?: MetaCapiRelayUserData;
  custom_data?: Record<string, unknown>;
  action_source?: string;
}

export interface MetaCapiRelayResult {
  ok: boolean;
  sent: boolean;
  reason?: 'not_configured' | 'meta_error' | 'internal_error';
  status?: number;
  error?: string;
  fbtrace_id?: string;
}

/**
 * Envia UM evento de conversão para a Meta CAPI. Nunca lança —
 * o chamador é fire-and-forget por natureza (lead público).
 */
export async function sendMetaCapiRelayEvent(
  payload: MetaCapiRelayEvent,
): Promise<MetaCapiRelayResult> {
  const pixelId = process.env.META_PIXEL_ID;
  const accessToken = process.env.META_ACCESS_TOKEN;

  if (!pixelId || !accessToken) {
    return { ok: true, sent: false, reason: 'not_configured' };
  }

  try {
    const { event_name, event_id, user_data: rawUserData, custom_data, action_source = 'website' } = payload;

    if (!event_name || typeof event_name !== 'string') {
      return { ok: false, sent: false, reason: 'internal_error', error: 'event_name is required' };
    }

    // Build user_data with hashed PII
    const userData: Record<string, string> = {};
    if (rawUserData && typeof rawUserData === 'object') {
      const ud = rawUserData as Record<string, string>;
      if (ud.email) {
        userData.em = await sha256(ud.email);
      }
      if (ud.phone) {
        // Normalize phone: remove non-digits, prepend country code
        let phone = (ud.phone || '').replace(/\D/g, '');
        if (phone.length >= 10 && !phone.startsWith('55')) {
          phone = '55' + phone;
        }
        if (phone.length >= 12) {
          userData.ph = await sha256(phone);
        }
      }
      if (ud.name) {
        userData.fn = await sha256(ud.name);
        if (ud.name.includes(' ')) {
          const parts = ud.name.trim().split(/\/+/);
          userData.ln = await sha256(parts[parts.length - 1]);
        }
      }
      if (ud.ip) {
        userData.client_ip_address = ud.ip;
      }
      if (ud.user_agent) {
        userData.client_user_agent = ud.user_agent;
      }
      if (ud.fbp) {
        userData.fbp = ud.fbp;
      }
      if (ud.fbc) {
        userData.fbc = ud.fbc;
      }
    }

    // Build the event payload
    const event: Record<string, unknown> = {
      event_name,
      event_time: Math.floor(Date.now() / 1000),
      event_source_url: rawUserData?.page_url || undefined,
      action_source,
      user_data: Object.keys(userData).length > 0 ? userData : undefined,
    };

    if (event_id) {
      event.event_id = event_id;
    }
    if (custom_data && typeof custom_data === 'object' && Object.keys(custom_data).length > 0) {
      event.custom_data = custom_data;
    }

    // Send to Meta CAPI
    const apiUrl = `${META_API_BASE}/${pixelId}/events?access_token=${accessToken}`;
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        data: [event],
      }),
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      console.error('[Meta CAPI relay] Error from Meta API:', response.status, JSON.stringify(result));
      return {
        ok: false,
        sent: true,
        reason: 'meta_error',
        status: response.status,
        error: result?.error?.message || 'Meta API error',
      };
    }

    const fbTraceId = result?.fbtrace_id;
    if (fbTraceId) {
      console.log(`[Meta CAPI relay] Event "${event_name}" sent successfully. fbtrace_id=${fbTraceId}`);
    }

    return { ok: true, sent: true, fbtrace_id: fbTraceId };
  } catch (error) {
    console.error('[Meta CAPI relay] Unexpected error:', error);
    return { ok: false, sent: false, reason: 'internal_error' };
  }
}
