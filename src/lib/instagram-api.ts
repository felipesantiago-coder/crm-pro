/**
 * instagram-api.ts — Instagram Graph API v22.0 Integration
 *
 * All Instagram Content Publishing API calls.
 * Uses raw fetch() — same pattern as Meta CAPI and lead polling.
 *
 * Required env vars:
 *   INSTAGRAM_APP_ID
 *   INSTAGRAM_APP_SECRET
 */

const IG_API_VERSION = 'v22.0';
const FB_GRAPH_BASE = `https://graph.facebook.com/${IG_API_VERSION}`;
const IG_API_BASE = `https://graph.instagram.com/${IG_API_VERSION}`;
const IG_OAUTH_BASE = 'https://api.instagram.com/oauth';

// ── Helpers ──────────────────────────────────────────────────────────────

function getEnvOrThrow(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`${key} não configurada. Defina no painel da Vercel.`);
  return v;
}

function igApiError(message: string, cause?: unknown): Error {
  const err = new Error(message);
  if (cause instanceof Error) err.cause = cause;
  return err;
}

/**
 * Fetch wrapper with error handling for Instagram/Facebook API calls.
 */
async function apiFetch(url: string, options?: RequestInit): Promise<unknown> {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  const text = await res.text();

  if (!res.ok) {
    let detail = text.slice(0, 500);
    try {
      const json = JSON.parse(detail);
      detail = json.error?.message || json.error?.type || detail;
    } catch { /* keep raw text */ }
    throw igApiError(`Instagram API ${res.status}: ${detail}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

// ── OAuth: Token Exchange ────────────────────────────────────────────────

/**
 * Exchange authorization code for a short-lived user access token.
 */
export async function exchangeCodeForToken(code: string, redirectUri: string) {
  const appId = getEnvOrThrow('INSTAGRAM_APP_ID');
  const appSecret = getEnvOrThrow('INSTAGRAM_APP_SECRET');

  const url = `${IG_OAUTH_BASE}/access_token?` + new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code,
  }).toString();

  return apiFetch(url) as Promise<{
    access_token: string;
    user_id: number;
  }>;
}

/**
 * Exchange a short-lived token for a long-lived one (~60 days).
 */
export async function exchangeForLongLivedToken(shortLivedToken: string) {
  const appId = getEnvOrThrow('INSTAGRAM_APP_ID');
  const appSecret = getEnvOrThrow('INSTAGRAM_APP_SECRET');

  const url = `${IG_OAUTH_BASE}/exchange_access_token?` + new URLSearchParams({
    client_id: appId,
    client_secret: appSecret,
    grant_type: 'ig_exchange_token',
    access_token: shortLivedToken,
  }).toString();

  return apiFetch(url) as Promise<{
    access_token: string;
    token_type: string;
    expires_in: number; // seconds (~5184000 = 60 days)
  }>;
}

/**
 * Refresh a long-lived token (must be done before expiration).
 */
export async function refreshLongLivedToken(longLivedToken: string) {
  const url = `${IG_API_BASE}/refresh_access_token?` + new URLSearchParams({
    grant_type: 'ig_refresh_token',
    access_token: longLivedToken,
  }).toString();

  return apiFetch(url) as Promise<{
    access_token: string;
    token_type: string;
    expires_in: number;
  }>;
}

// ── Business Account Discovery ──────────────────────────────────────────

/**
 * Get the Facebook Pages owned by the user (needed to find the IG-linked page).
 */
export async function getUserFacebookPages(userAccessToken: string) {
  const url = `${FB_GRAPH_BASE}/me/accounts?fields=id,name,access_token&access_token=${userAccessToken}`;
  return apiFetch(url) as Promise<{
    data: Array<{ id: string; name: string; access_token: string }>;
  }>;
}

/**
 * Get the Instagram Business Account linked to a Facebook Page.
 */
export async function getInstagramBusinessAccount(pageAccessToken: string, pageId: string) {
  const url = `${FB_GRAPH_BASE}/${pageId}?fields=instagram_business_account{id,username,name}&access_token=${pageAccessToken}`;
  const data = await apiFetch(url) as {
    instagram_business_account?: { id: string; username: string; name: string };
    error?: { message: string };
  };

  if (data.error) {
    throw igApiError(`Erro ao buscar conta Instagram: ${data.error.message}`);
  }
  if (!data.instagram_business_account) {
    throw igApiError('Nenhuma conta Instagram Business vinculada a esta Página do Facebook.');
  }

  return data.instagram_business_account;
}

// ── Content Publishing ───────────────────────────────────────────────────

/**
 * Create a media container (image post). The image URL must be publicly accessible.
 * Returns the container ID — the container must finish processing before publishing.
 */
export async function createMediaContainer(
  igUserId: string,
  imageUrl: string,
  caption: string,
  accessToken: string,
) {
  const url = `${FB_GRAPH_BASE}/${igUserId}/media?` + new URLSearchParams({
    image_url: imageUrl,
    caption,
    access_token: accessToken,
  }).toString();

  const data = await apiFetch(url) as { id?: string; error?: { message: string } };

  if (data.error) {
    throw igApiError(`Erro ao criar container: ${data.error.message}`);
  }
  if (!data.id) {
    throw igApiError('Instagram não retornou ID do container de mídia.');
  }

  return data.id;
}

/**
 * Check if a media container has finished processing.
 * For images, this is usually instant. For videos, it can take minutes.
 */
export async function getMediaContainerStatus(containerId: string, accessToken: string) {
  const url = `${FB_GRAPH_BASE}/${containerId}?fields=status_code&access_token=${accessToken}`;
  const data = await apiFetch(url) as { status_code: string };
  return data.status_code; // 'IN_PROGRESS' | 'FINISHED' | 'ERROR'
}

/**
 * Publish a media container that has finished processing.
 * Returns the published media ID.
 */
export async function publishMediaContainer(
  igUserId: string,
  containerId: string,
  accessToken: string,
) {
  const url = `${FB_GRAPH_BASE}/${igUserId}/media_publish?` + new URLSearchParams({
    creation_id: containerId,
    access_token: accessToken,
  }).toString();

  const data = await apiFetch(url) as { id?: string; error?: { message: string } };

  if (data.error) {
    throw igApiError(`Erro ao publicar: ${data.error.message}`);
  }
  if (!data.id) {
    throw igApiError('Instagram não retornou ID da publicação.');
  }

  return data.id;
}

/**
 * Get the permalink (public URL) of a published Instagram media.
 */
export async function getMediaPermalink(mediaId: string, accessToken: string) {
  const url = `${FB_GRAPH_BASE}/${mediaId}?fields=permalink&access_token=${accessToken}`;
  const data = await apiFetch(url) as { permalink?: string };
  return data.permalink || null;
}

// ── Full Publish Flow (container → wait → publish) ──────────────────────

const MAX_CONTAINER_WAIT_MS = 30_000;
const CONTAINER_POLL_INTERVAL = 2_000;

/**
 * Complete flow: create container, wait for processing, publish.
 * Returns { mediaId, permalink }.
 */
export async function publishImagePost(
  igUserId: string,
  imageUrl: string,
  caption: string,
  accessToken: string,
): Promise<{ mediaId: string; permalink: string | null }> {
  // Step 1: Create container
  const containerId = await createMediaContainer(igUserId, imageUrl, caption, accessToken);
  console.log(`[Instagram API] Container created: ${containerId}`);

  // Step 2: Wait for processing (images are usually instant, but we poll to be safe)
  const startTime = Date.now();
  let status = 'IN_PROGRESS';
  while (status === 'IN_PROGRESS' && Date.now() - startTime < MAX_CONTAINER_WAIT_MS) {
    await new Promise((r) => setTimeout(r, CONTAINER_POLL_INTERVAL));
    status = await getMediaContainerStatus(containerId, accessToken);
  }

  if (status === 'ERROR') {
    throw igApiError(`Container ${containerId} falhou ao processar.`);
  }
  if (status !== 'FINISHED') {
    throw igApiError(`Container ${containerId} não terminou de processar a tempo.`);
  }

  // Step 3: Publish
  const mediaId = await publishMediaContainer(igUserId, containerId, accessToken);
  console.log(`[Instagram API] Published media: ${mediaId}`);

  // Step 4: Get permalink
  const permalink = await getMediaPermalink(mediaId, accessToken);

  return { mediaId, permalink };
}
