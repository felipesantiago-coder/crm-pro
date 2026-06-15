import crypto from 'crypto';

const PORTAL_SECRET = process.env.NEXTAUTH_SECRET || 'crm-portal-secret';

/**
 * Generates a signed portal token for a client.
 * Token = base64url(HMAC-SHA256(clientId + '|' + clientCreatedAt, PORTAL_SECRET))
 *
 * This is deterministic — the same client always gets the same token.
 * No database changes required.
 */
export function generatePortalToken(clientId: string, createdAt: string): string {
  const payload = `${clientId}|${createdAt}`;
  const hmac = crypto.createHmac('sha256', PORTAL_SECRET);
  hmac.update(payload);
  const signature = hmac.digest('base64url');
  return signature;
}

/**
 * Verifies a portal token against a client ID.
 * Returns true if the token is valid for the given client.
 */
export function verifyPortalToken(
  token: string,
  clientId: string,
  createdAt: string
): boolean {
  const expected = generatePortalToken(clientId, createdAt);
  // Constant-time comparison to prevent timing attacks
  return crypto.timingSafeEqual(
    Buffer.from(token),
    Buffer.from(expected)
  );
}

/**
 * Generates the full portal URL for a client.
 */
export function getPortalUrl(clientId: string, createdAt: string): string {
  const token = generatePortalToken(clientId, createdAt);
  // Use base URL from env or default to current origin
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || '';
  return `${baseUrl}/portal?t=${token}&c=${clientId}`;
}