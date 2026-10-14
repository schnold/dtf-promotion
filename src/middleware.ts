import { defineMiddleware } from 'astro:middleware';

const contentSecurityPolicy = (nonce: string) => [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self'",
  "font-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data:",
  "object-src 'none'",
  `script-src 'self' 'nonce-${nonce}'`,
  "style-src 'self'",
  "style-src-attr 'unsafe-inline'",
].join('; ');

export const onRequest = defineMiddleware(async (context, next) => {
  const nonceBytes = crypto.getRandomValues(new Uint8Array(18));
  const nonce = Array.from(nonceBytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  context.locals.cspNonce = nonce;
  const response = await next();
  const headers = response.headers;

  headers.set('Content-Security-Policy', contentSecurityPolicy(nonce));
  headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  headers.set('Permissions-Policy', 'camera=(), geolocation=(), microphone=()');
  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.set('X-Frame-Options', 'DENY');

  const forwardedProtocol = context.request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
  if (context.url.protocol === 'https:' || forwardedProtocol === 'https') {
    headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  if (context.url.pathname.startsWith('/admin') || context.url.pathname.startsWith('/api/admin')) {
    headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
    headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
  }

  return response;
});
