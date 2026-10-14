import { createHash, timingSafeEqual } from 'node:crypto';

function secureEqual(left: string, right: string): boolean {
  const leftHash = createHash('sha256').update(left).digest();
  const rightHash = createHash('sha256').update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

export function getAdminConfigurationError(): string | null {
  const username = process.env.ADMIN_USERNAME?.trim();
  const password = process.env.ADMIN_PASSWORD;
  if (!username || !password) return 'ADMIN_USERNAME und ADMIN_PASSWORD fehlen.';
  if (username.includes(':')) return 'ADMIN_USERNAME darf keinen Doppelpunkt enthalten.';
  if (password.length < 12) return 'ADMIN_PASSWORD muss mindestens 12 Zeichen lang sein.';
  if (password === 'replace-with-a-long-random-password') return 'ADMIN_PASSWORD verwendet noch den Beispielwert.';
  return null;
}

export function hasAdminCredentials(): boolean {
  return getAdminConfigurationError() === null;
}

export function isAdminRequest(request: Request): boolean {
  if (getAdminConfigurationError()) return false;
  const expectedUsername = process.env.ADMIN_USERNAME?.trim();
  const expectedPassword = process.env.ADMIN_PASSWORD;
  if (!expectedUsername || !expectedPassword) return false;

  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Basic ')) return false;

  try {
    const decoded = Buffer.from(authorization.slice(6), 'base64').toString('utf8');
    const separator = decoded.indexOf(':');
    if (separator < 0) return false;
    const username = decoded.slice(0, separator);
    const password = decoded.slice(separator + 1);
    return secureEqual(username, expectedUsername) && secureEqual(password, expectedPassword);
  } catch {
    return false;
  }
}

export function unauthorizedResponse(): Response {
  return new Response('Authentifizierung erforderlich.', {
    status: 401,
    headers: {
      'WWW-Authenticate': 'Basic realm="DTF Transferprint Admin", charset="UTF-8"',
      'Cache-Control': 'no-store',
    },
  });
}

export function isSameOriginPost(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (origin) {
    try {
      const originUrl = new URL(origin);
      const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
      const requestHost = forwardedHost || request.headers.get('host');
      const forwardedProtocol = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
      if (requestHost && originUrl.host !== requestHost) return false;
      if (forwardedProtocol && originUrl.protocol !== `${forwardedProtocol}:`) return false;
    } catch {
      return false;
    }
  }
  const fetchSite = request.headers.get('sec-fetch-site');
  return !fetchSite || fetchSite === 'same-origin' || fetchSite === 'none';
}
