import { type Cms, fill, stripMeta } from './cms';
import { settingsFrom, type SiteSettings } from './settings';

/**
 * Everything a page needs, derived from one cms.json document: either the published content
 * from the database (live page), the admin's draft (preview) or the bundled src/data/cms.json.
 */
export interface SiteView {
  cms: Cms;
  settings: SiteSettings;
  SITE_NAME: string;
  /** Canonical selini-shirt.de URLs (`shared.shop`); every fixed shop link on the page comes from here. */
  SHOP: ReturnType<typeof stripMeta<Cms['shared']['shop']>>;
  COMPANY: ReturnType<typeof stripMeta<Cms['shared']['company']>>;
  /** Footer legal links (`shared.legal.items`). */
  LEGAL_LINKS: ReturnType<typeof stripMeta<Cms['shared']['legal']['items']>>;
}

export function buildSiteView(cms: Cms): SiteView {
  return {
    cms,
    settings: settingsFrom(cms),
    SITE_NAME: cms.site.name,
    SHOP: stripMeta(cms.shared.shop),
    COMPANY: stripMeta(cms.shared.company),
    LEGAL_LINKS: stripMeta(cms.shared.legal.items),
  };
}

/** Keyword first, ≤ 60 characters. Price is injected from settings; template is `site.seo.titleTemplate`. */
export function buildSeoTitle(cms: Cms, pricePerMeterLabel: string): string {
  return fill(cms.site.seo.titleTemplate, { price: pricePerMeterLabel });
}

/** 140–160 characters with price and production time; template is `site.seo.descriptionTemplate`. */
export function buildSeoDescription(cms: Cms, pricePerMeterLabel: string, lowestTierLabel: string): string {
  return fill(cms.site.seo.descriptionTemplate, { price: pricePerMeterLabel, lowestTierPrice: lowestTierLabel });
}

/** Canonical origin: PUBLIC_SITE_URL env → cms.json `site.liveUrl` → Netlify `URL` env → request origin. */
export function getPublicOrigin(request: Request, cms: Cms): string {
  const configuredUrl = process.env.PUBLIC_SITE_URL?.trim() || cms.site.liveUrl?.trim() || process.env.URL?.trim();
  if (configuredUrl) {
    try {
      return new URL(configuredUrl).origin;
    } catch {
      console.error('PUBLIC_SITE_URL / site.liveUrl is not a valid absolute URL. Falling back to the request origin.');
    }
  }

  return new URL(request.url).origin;
}

export function absoluteSiteUrl(request: Request, pathname: string, cms: Cms): string {
  return new URL(pathname, `${getPublicOrigin(request, cms)}/`).toString();
}
