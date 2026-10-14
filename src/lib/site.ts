export const SITE_NAME = 'DTF Transferprint';
export const SITE_TITLE = 'DTF Transferprint — Mehr Motiv. Weniger Meter.';
export const SITE_DESCRIPTION = 'DTF Transfers aus eigener Berliner Produktion: farbstark, präzise und fair kalkuliert. Jetzt bei Selini-Shirt bestellen.';

export function getPublicOrigin(request: Request): string {
  const configuredUrl = process.env.PUBLIC_SITE_URL?.trim() || process.env.URL?.trim();
  if (configuredUrl) {
    try {
      return new URL(configuredUrl).origin;
    } catch {
      console.error('PUBLIC_SITE_URL is not a valid absolute URL. Falling back to the request origin.');
    }
  }

  return new URL(request.url).origin;
}

export function absoluteSiteUrl(request: Request, pathname = '/'): string {
  return new URL(pathname, `${getPublicOrigin(request)}/`).toString();
}
