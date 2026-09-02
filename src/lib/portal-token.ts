import crypto from 'crypto';

const PORTAL_SECRET = process.env.NEXTAUTH_SECRET || 'crm-portal-secret';
const PORTAL_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

/**
 * Generates a signed portal token for a client.
 * Token format: base64url(timestamp) + '.' + base64url(HMAC-SHA256(clientId|createdAt|timestamp, secret))
 */
export function generatePortalToken(clientId: string, createdAt: string): string {
  const timestamp = Date.now().toString();
  const payload = `${clientId}|${createdAt}|${timestamp}`;
  const hmac = crypto.createHmac('sha256', PORTAL_SECRET);
  hmac.update(payload);
  const signature = hmac.digest('base64url');
  const tsEncoded = Buffer.from(timestamp).toString('base64url');
  return `${tsEncoded}.${signature}`;
}

/**
 * Verifies a portal token against a client ID.
 * Returns { valid: true } if the token is valid and not expired.
 * Returns { valid: false, reason: 'invalid' | 'expired' } otherwise.
 */
export function verifyPortalToken(
  token: string,
  clientId: string,
  createdAt: string
): { valid: true } | { valid: false; reason: 'invalid' | 'expired' } {
  const parts = token.split('.');
  if (parts.length !== 2) return { valid: false, reason: 'invalid' };

  const [tsEncoded, signature] = parts;
  let timestamp: string;
  try {
    timestamp = Buffer.from(tsEncoded, 'base64url').toString();
  } catch {
    return { valid: false, reason: 'invalid' };
  }

  // Verificar TTL
  const tokenAge = Date.now() - parseInt(timestamp, 10);
  if (tokenAge > PORTAL_TOKEN_TTL_MS || isNaN(tokenAge)) {
    return { valid: false, reason: 'expired' };
  }

  // Verificar HMAC
  const payload = `${clientId}|${createdAt}|${timestamp}`;
  const hmac = crypto.createHmac('sha256', PORTAL_SECRET);
  hmac.update(payload);
  const expected = hmac.digest('base64url');

  try {
    const isValid = crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expected)
    );
    return isValid ? { valid: true } : { valid: false, reason: 'invalid' };
  } catch {
    return { valid: false, reason: 'invalid' };
  }
}

/**
 * Generates the full portal URL for a client.
 */
export function getPortalUrl(clientId: string, createdAt: string): string {
  const token = generatePortalToken(clientId, createdAt);
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || '';
  return `${baseUrl}/portal?t=${token}&c=${clientId}`;
}
