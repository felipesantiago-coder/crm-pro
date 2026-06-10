/**
 * Google Calendar Integration
 *
 * Handles OAuth2 flow, token management, and calendar event CRUD.
 * Uses direct fetch calls (no googleapis dependency) for minimal bundle size.
 *
 * Required env vars:
 *   GOOGLE_CLIENT_ID       — OAuth 2.0 Client ID from Google Cloud Console
 *   GOOGLE_CLIENT_SECRET   — OAuth 2.0 Client Secret
 *   GOOGLE_REDIRECT_URI    — Must match the authorized redirect URI in Google Console
 *                            e.g. https://seu-dom.vercel.app/api/google-calendar/callback
 */

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

function getClientId(): string {
  const id = process.env.GOOGLE_CLIENT_ID;
  if (!id) throw new Error('GOOGLE_CLIENT_ID não configurada');
  return id;
}

function getClientSecret(): string {
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!secret) throw new Error('GOOGLE_CLIENT_SECRET não configurada');
  return secret;
}

function getRedirectUri(): string {
  const uri = process.env.GOOGLE_REDIRECT_URI;
  if (!uri) throw new Error('GOOGLE_REDIRECT_URI não configurada');
  return uri;
}

// ─── OAuth URL ────────────────────────────────────────────────

export function getAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: getClientId(),
    redirect_uri: getRedirectUri(),
    response_type: 'code',
    scope: SCOPES,
    access_type: 'offline',
    prompt: 'consent', // garante que recebemos refresh_token
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

// ─── Token Exchange ───────────────────────────────────────────

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

export async function exchangeCodeForTokens(code: string): Promise<{
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: getClientId(),
      client_secret: getClientSecret(),
      redirect_uri: getRedirectUri(),
      grant_type: 'authorization_code',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Erro ao trocar código por tokens: ${err}`);
  }

  const data: TokenResponse = await res.json();

  if (!data.refresh_token) {
    throw new Error('Refresh token não recebido. Tente desconectar e reconectar.');
  }

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

// ─── Token Refresh ────────────────────────────────────────────

export async function refreshAccessToken(refreshToken: string): Promise<{
  accessToken: string;
  expiresAt: Date;
}> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: getClientId(),
      client_secret: getClientSecret(),
      grant_type: 'refresh_token',
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Erro ao renovar token: ${err}`);
  }

  const data: TokenResponse = await res.json();

  return {
    accessToken: data.access_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
  };
}

// ─── Get valid access token (auto-refresh) ────────────────────

import { db } from './db';

async function getValidAccessToken(userId: string): Promise<string> {
  const token = await db.googleCalendarToken.findUnique({
    where: { userId },
  });

  if (!token) {
    throw new Error('Google Calendar não conectado para este usuário');
  }

  // Se o token expira nos próximos 5 minutos, renova
  if (token.expiresAt.getTime() - Date.now() < 5 * 60 * 1000) {
    const refreshed = await refreshAccessToken(token.refreshToken);
    await db.googleCalendarToken.update({
      where: { userId },
      data: {
        accessToken: refreshed.accessToken,
        expiresAt: refreshed.expiresAt,
      },
    });
    return refreshed.accessToken;
  }

  return token.accessToken;
}

// ─── Create Calendar Event ────────────────────────────────────

export interface CreateEventParams {
  userId: string;
  summary: string;
  description?: string;
  date: string;       // yyyy-MM-dd
  time: string;       // HH:mm
  timeZone?: string;  // default: America/Sao_Paulo
}

export async function createCalendarEvent(params: CreateEventParams): Promise<string> {
  const accessToken = await getValidAccessToken(params.userId);
  const tz = params.timeZone || 'America/Sao_Paulo';

  const startDateTime = `${params.date}T${params.time}:00`;
  // Duração padrão de 1 hora
  const [hours, minutes] = params.time.split(':').map(Number);
  const endHours = hours + 1;
  const endDateTime = `${params.date}T${String(endHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;

  const body = {
    summary: params.summary,
    description: params.description || '',
    start: {
      dateTime: startDateTime,
      timeZone: tz,
    },
    end: {
      dateTime: endDateTime,
      timeZone: tz,
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: 'popup', minutes: 24 * 60 },   // 24 horas antes
        { method: 'popup', minutes: 2 * 60 },     // 2 horas antes
        { method: 'email', minutes: 24 * 60 },    // 24 horas antes (e-mail)
        { method: 'email', minutes: 2 * 60 },     // 2 horas antes (e-mail)
      ],
    },
  };

  const res = await fetch(`${GOOGLE_CALENDAR_API}/calendars/primary/events`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error('[Google Calendar] Erro ao criar evento:', err);
    throw new Error(`Erro ao criar evento no Google Calendar: ${res.status}`);
  }

  const event = await res.json();
  return event.id as string;
}

// ─── Update Calendar Event ────────────────────────────────────

export interface UpdateEventParams {
  userId: string;
  eventId: string;
  summary?: string;
  description?: string;
  date?: string;
  time?: string;
  status?: 'COMPLETED' | 'CANCELLED';
  timeZone?: string;
}

export async function updateCalendarEvent(params: UpdateEventParams): Promise<void> {
  const accessToken = await getValidAccessToken(params.userId);
  const tz = params.timeZone || 'America/Sao_Paulo';

  // Busca o evento atual
  const getRes = await fetch(
    `${GOOGLE_CALENDAR_API}/calendars/primary/events/${params.eventId}`,
    { headers: { 'Authorization': `Bearer ${accessToken}` } }
  );

  if (getRes.status === 404) {
    console.warn('[Google Calendar] Evento não encontrado, possivelmente já removido:', params.eventId);
    return; // não é erro crítico
  }

  if (!getRes.ok) {
    const err = await getRes.text();
    console.error('[Google Calendar] Erro ao buscar evento:', err);
    throw new Error(`Erro ao buscar evento no Google Calendar: ${getRes.status}`);
  }

  const existingEvent = await getRes.json();

  const body: Record<string, unknown> = {
    summary: params.summary || existingEvent.summary,
    description: params.description !== undefined ? params.description : existingEvent.description,
    start: existingEvent.start,
    end: existingEvent.end,
    reminders: existingEvent.reminders,
  };

  // Se a visita foi cancelada ou concluída, atualiza o título
  if (params.status === 'CANCELLED') {
    body.summary = `[CANCELADA] ${params.summary || existingEvent.summary}`;
    body.description = `⚠️ Visita cancelada no CRM Pro\n\n${params.description || existingEvent.description || ''}`;
  } else if (params.status === 'COMPLETED') {
    body.summary = `[REALIZADA] ${params.summary || existingEvent.summary}`;
    body.description = `✅ Visita realizada no CRM Pro\n\n${params.description || existingEvent.description || ''}`;
  }

  // Se data/hora foram alteradas
  if (params.date && params.time) {
    const startDateTime = `${params.date}T${params.time}:00`;
    const [hours, minutes] = params.time.split(':').map(Number);
    const endHours = hours + 1;
    const endDateTime = `${params.date}T${String(endHours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
    body.start = { dateTime: startDateTime, timeZone: tz };
    body.end = { dateTime: endDateTime, timeZone: tz };
  }

  const res = await fetch(
    `${GOOGLE_CALENDAR_API}/calendars/primary/events/${params.eventId}`,
    {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const err = await res.text();
    console.error('[Google Calendar] Erro ao atualizar evento:', err);
    throw new Error(`Erro ao atualizar evento no Google Calendar: ${res.status}`);
  }
}

// ─── Delete Calendar Event ────────────────────────────────────

export async function deleteCalendarEvent(userId: string, eventId: string): Promise<void> {
  const accessToken = await getValidAccessToken(userId);

  const res = await fetch(
    `${GOOGLE_CALENDAR_API}/calendars/primary/events/${eventId}`,
    {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${accessToken}` },
    }
  );

  if (res.status === 404) {
    console.warn('[Google Calendar] Evento não encontrado para exclusão:', eventId);
    return; // não é erro crítico
  }

  if (!res.ok) {
    const err = await res.text();
    console.error('[Google Calendar] Erro ao excluir evento:', err);
    throw new Error(`Erro ao excluir evento no Google Calendar: ${res.status}`);
  }
}