import { type Cms, REFERENCE } from './cms';
import { syncToReference } from './content-schema';
import { getPool, query } from './db';
import { settingsFrom } from './settings';
import { buildSiteView, type SiteView } from './site';

export const SITE_ID = 'dtf-transferprint';

/** Netlify CDN cache tag of every page that shows published content; purged on publish. */
export const CONTENT_CACHE_TAG = 'cms';

export interface PublishedContent {
  view: SiteView;
  version: number | null;
  publishedAt: Date | null;
  /** `database`: published in the admin. `bundled`: src/data/cms.json (nothing published yet). `fallback`: database error. */
  source: 'database' | 'bundled' | 'fallback';
}

const MEMORY_TTL_MS = 30_000;
let memory: { at: number; value: PublishedContent } | null = null;

const bundled = (source: PublishedContent['source']): PublishedContent => ({ view: buildSiteView(REFERENCE), version: null, publishedAt: null, source });

/** Brings stored content in line with the current code's cms.json structure and checks the prices. */
export function toCms(data: unknown): Cms {
  const cms = syncToReference(REFERENCE, data);
  settingsFrom(cms);
  return cms;
}

async function loadPublished(): Promise<PublishedContent> {
  if (!getPool()) return bundled('bundled');
  try {
    const [row] = await query<{ data: string; version: number; published_at: Date }>(
      `SELECT v.data, v.version, v.published_at
         FROM site_content c
         JOIN site_versions v ON v.site_id = c.site_id AND v.version = c.published_version
        WHERE c.site_id = $1`,
      [SITE_ID],
    );
    if (!row) return bundled('bundled');
    return { view: buildSiteView(toCms(JSON.parse(row.data))), version: row.version, publishedAt: row.published_at, source: 'database' };
  } catch (error) {
    console.error('Published content could not be loaded; serving the bundled cms.json.', error);
    return bundled('fallback');
  }
}

/** The content the public pages show. Cached briefly per function instance; the CDN caches the pages. */
export async function getPublishedContent(): Promise<PublishedContent> {
  if (memory && Date.now() - memory.at < MEMORY_TTL_MS) return memory.value;
  const value = await loadPublished();
  // A database error is not cached, so the next request tries again.
  memory = value.source === 'fallback' ? null : { at: Date.now(), value };
  return value;
}

export function forgetPublishedContent(): void {
  memory = null;
}

/**
 * Cache headers for a page built from published content. Browsers revalidate every time; Netlify's
 * CDN keeps the page until the next publish purges the `cms` tag (or 1 h after a database error).
 */
export function publicCacheHeaders(headers: Headers, content: PublishedContent): void {
  headers.set('Cache-Control', 'public, max-age=0, must-revalidate');
  headers.set('Netlify-CDN-Cache-Control', content.source === 'fallback' ? 'public, s-maxage=60' : 'public, durable, s-maxage=31536000, stale-while-revalidate=300');
  headers.set('Netlify-Cache-Tag', CONTENT_CACHE_TAG);
}
