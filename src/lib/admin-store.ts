import { createHash } from 'node:crypto';
import { purgeCache } from '@netlify/cache';
import sharp from 'sharp';
import bundledImages from '../data/bundled-images.json';
import type { AdminUser } from './auth';
import { type Cms, REFERENCE } from './cms';
import { CONTENT_CACHE_TAG, forgetPublishedContent, SITE_ID, toCms } from './content';
import { sameContent, syncToReference, validateContent, ValidationError } from './content-schema';
import { query, transaction } from './db';
import { SettingsValidationError, validateSettings } from './settings';

/** The site as the admin client (public/admin/app.js) knows it. */
export const SITE = {
  id: SITE_ID,
  label: 'DTF Transferprint',
  note: 'DTF-Käufer & Selbstpresser',
  accent: '#c6f432',
};

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ---------------------------------------------------------------- audit

export async function audit(action: string, opts: { user?: AdminUser | null; ip?: string | null; detail?: unknown } = {}): Promise<void> {
  const detail = opts.detail === undefined ? null : String(typeof opts.detail === 'string' ? opts.detail : JSON.stringify(opts.detail)).slice(0, 2000);
  await query('INSERT INTO audit (user_id, user_email, action, site_id, ip, detail) VALUES ($1,$2,$3,$4,$5,$6)', [
    opts.user?.id ?? null,
    opts.user?.email ?? null,
    action,
    SITE_ID,
    opts.ip ?? null,
    detail,
  ]);
}

export async function listAudit() {
  return query('SELECT at, user_email, action, site_id, ip, detail FROM audit ORDER BY at DESC LIMIT 300');
}

// ---------------------------------------------------------------- content

/** Checks structure (against the bundled cms.json) and prices; returns the cleaned document. */
export function checkContent(value: unknown): Cms {
  const data = validateContent(REFERENCE, value);
  try {
    validateSettings(data.shared.pricing);
  } catch (error) {
    if (error instanceof SettingsValidationError) throw new ValidationError(`Preise: ${error.message}`, 'shared.pricing');
    throw error;
  }
  return data;
}

/** Creates the content row on first use: draft and version 1 = the bundled cms.json. */
async function ensureContent(): Promise<void> {
  const data = JSON.stringify(REFERENCE);
  await transaction(async (tx) => {
    const inserted = await tx.query(
      `INSERT INTO site_content (site_id, draft, draft_rev, draft_updated_by, published_version)
       VALUES ($1, $2, 1, 'system', 1) ON CONFLICT (site_id) DO NOTHING RETURNING site_id`,
      [SITE_ID, data],
    );
    if (inserted.length) {
      await tx.query('INSERT INTO site_versions (site_id, version, data, published_by, note) VALUES ($1, 1, $2, $3, $4)', [SITE_ID, data, 'system', 'Ausgangsstand aus dem Code']);
    }
  });
}

interface ContentRow {
  draft: string;
  draft_rev: number;
  draft_updated_at: Date;
  draft_updated_by: string;
  published_version: number;
}

export async function contentState() {
  await ensureContent();
  const [row] = await query<ContentRow>('SELECT * FROM site_content WHERE site_id = $1', [SITE_ID]);
  const [pub] = await query<{ data: string; published_at: Date; published_by: string }>(
    'SELECT data, published_at, published_by FROM site_versions WHERE site_id = $1 AND version = $2',
    [SITE_ID, row.published_version],
  );
  // Keep drafts and the published version in step with the current cms.json structure.
  const draft = syncToReference(REFERENCE, JSON.parse(row.draft));
  const published = pub ? syncToReference(REFERENCE, JSON.parse(pub.data)) : null;
  return {
    draft,
    rev: row.draft_rev,
    updatedAt: row.draft_updated_at,
    updatedBy: row.draft_updated_by,
    publishedVersion: row.published_version,
    published,
    publishedAt: pub?.published_at ?? null,
    publishedBy: pub?.published_by ?? null,
    hasUnpublished: !sameContent(draft, published),
  };
}

export async function siteSummary() {
  const st = await contentState();
  return {
    ...SITE,
    liveUrl: st.published?.site?.liveUrl || st.draft?.site?.liveUrl || '',
    pageCount: Object.keys(st.draft.pages || {}).length,
    publishedVersion: st.publishedVersion,
    publishedAt: st.publishedAt,
    publishedBy: st.publishedBy,
    updatedAt: st.updatedAt,
    updatedBy: st.updatedBy,
    hasUnpublished: st.hasUnpublished,
  };
}

export async function saveDraft(user: AdminUser, value: unknown, rev: unknown) {
  const data = checkContent(value);
  const next = await transaction(async (tx) => {
    const [row] = await tx.query<{ draft_rev: number }>('SELECT draft_rev FROM site_content WHERE site_id = $1 FOR UPDATE', [SITE_ID]);
    if (Number(rev) !== row.draft_rev) {
      throw new HttpError(409, 'Jemand anderes hat inzwischen gespeichert. Bitte neu laden – Ihre Änderungen bleiben bis dahin hier stehen.');
    }
    await tx.query('UPDATE site_content SET draft = $1, draft_rev = draft_rev + 1, draft_updated_at = now(), draft_updated_by = $2 WHERE site_id = $3', [
      JSON.stringify(data),
      user.email,
      SITE_ID,
    ]);
    return row.draft_rev + 1;
  });
  const st = await contentState();
  return { rev: next, draft: data, hasUnpublished: st.hasUnpublished };
}

/** Drops the CDN copies of every page with published content, so the next visit renders the new version. */
async function refreshLivePages(): Promise<{ state: 'ok' | 'error'; message: string }> {
  forgetPublishedContent();
  if (import.meta.env.DEV) return { state: 'ok', message: 'Sofort online (lokal: kein CDN).' };
  try {
    await purgeCache({ tags: [CONTENT_CACHE_TAG] });
    return { state: 'ok', message: 'Die Änderung ist jetzt online.' };
  } catch (error) {
    console.error('purgeCache failed', error);
    return { state: 'error', message: 'Veröffentlicht, aber der CDN-Cache konnte nicht geleert werden. Die Seite zeigt die Änderung spätestens nach dem nächsten Deploy.' };
  }
}

async function publishData(tx: Parameters<Parameters<typeof transaction>[0]>[0], data: Cms, user: AdminUser, note: string | null): Promise<number> {
  const [row] = await tx.query<{ published_version: number }>('SELECT published_version FROM site_content WHERE site_id = $1 FOR UPDATE', [SITE_ID]);
  const next = row.published_version + 1;
  await tx.query('INSERT INTO site_versions (site_id, version, data, published_by, note) VALUES ($1,$2,$3,$4,$5)', [SITE_ID, next, JSON.stringify(data), user.email, note]);
  await tx.query('UPDATE site_content SET published_version = $1 WHERE site_id = $2', [next, SITE_ID]);
  return next;
}

export async function publish(user: AdminUser, note: unknown, ip: string | null) {
  await ensureContent();
  const cleanNote = String(note ?? '').slice(0, 300).trim() || null;
  const version = await transaction(async (tx) => {
    const [row] = await tx.query<ContentRow>('SELECT draft, published_version FROM site_content WHERE site_id = $1 FOR UPDATE', [SITE_ID]);
    const draft = checkContent(syncToReference(REFERENCE, JSON.parse(row.draft)));
    toCms(draft); // the page renders exactly this, so it must pass the same checks
    const [pub] = await tx.query<{ data: string }>('SELECT data FROM site_versions WHERE site_id = $1 AND version = $2', [SITE_ID, row.published_version]);
    if (pub && sameContent(syncToReference(REFERENCE, JSON.parse(pub.data)), draft)) throw new HttpError(409, 'Es gibt keine unveröffentlichten Änderungen.');
    return publishData(tx, draft, user, cleanNote);
  });
  await audit('publish', { user, ip, detail: { version, note: cleanNote } });
  return { version, build: await refreshLivePages() };
}

export async function discardDraft(user: AdminUser) {
  const st = await contentState();
  await query('UPDATE site_content SET draft = $1, draft_rev = draft_rev + 1, draft_updated_at = now(), draft_updated_by = $2 WHERE site_id = $3', [
    JSON.stringify(st.published),
    user.email,
    SITE_ID,
  ]);
}

export async function listVersions() {
  await ensureContent();
  return query('SELECT version, published_at, published_by, note FROM site_versions WHERE site_id = $1 ORDER BY version DESC LIMIT 100', [SITE_ID]);
}

export async function restoreVersion(user: AdminUser, version: number) {
  const [row] = await query<{ data: string }>('SELECT data FROM site_versions WHERE site_id = $1 AND version = $2', [SITE_ID, version]);
  if (!row) throw new HttpError(404, 'Version nicht gefunden');
  const data = syncToReference(REFERENCE, JSON.parse(row.data));
  await query('UPDATE site_content SET draft = $1, draft_rev = draft_rev + 1, draft_updated_at = now(), draft_updated_by = $2 WHERE site_id = $3', [
    JSON.stringify(data),
    user.email,
    SITE_ID,
  ]);
}

/** Sets `site.liveUrl` in the draft and publishes that single change right away. */
export async function setLiveUrl(user: AdminUser, liveUrl: unknown) {
  await ensureContent();
  const result = await transaction(async (tx) => {
    const [row] = await tx.query<ContentRow>('SELECT draft, published_version FROM site_content WHERE site_id = $1 FOR UPDATE', [SITE_ID]);
    const draft = syncToReference(REFERENCE, JSON.parse(row.draft));
    draft.site.liveUrl = String(liveUrl ?? '');
    const checked = checkContent(draft);
    await tx.query('UPDATE site_content SET draft = $1, draft_rev = draft_rev + 1, draft_updated_at = now(), draft_updated_by = $2 WHERE site_id = $3', [
      JSON.stringify(checked),
      user.email,
      SITE_ID,
    ]);
    const [pub] = await tx.query<{ data: string }>('SELECT data FROM site_versions WHERE site_id = $1 AND version = $2', [SITE_ID, row.published_version]);
    const published = syncToReference(REFERENCE, JSON.parse(pub.data));
    if (published.site.liveUrl === checked.site.liveUrl) return { version: null, liveUrl: checked.site.liveUrl };
    published.site.liveUrl = checked.site.liveUrl;
    const version = await publishData(tx, published, user, `Live-URL: ${checked.site.liveUrl || '(leer)'}`);
    return { version, liveUrl: checked.site.liveUrl };
  });
  return { ...result, build: result.version ? await refreshLivePages() : null };
}

export async function checkLive(url: string) {
  if (!url) return { state: 'unset' };
  const started = Date.now();
  try {
    const target = new URL(url);
    if (!/^https?:$/.test(target.protocol)) return { state: 'down', error: 'ungültig' };
    const res = await fetch(target, { redirect: 'follow', signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'dtf-transferprint-admin-check' } });
    const html = (res.headers.get('content-type') || '').includes('html') ? (await res.text()).slice(0, 200_000) : '';
    const title = html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim().slice(0, 200) ?? '';
    return { state: res.ok ? 'up' : 'error', status: res.status, title, ms: Date.now() - started, finalUrl: res.url };
  } catch (error) {
    const err = error as Error & { cause?: { code?: string } };
    return { state: 'down', error: err.name === 'TimeoutError' ? 'Zeitüberschreitung nach 8 s' : String(err.cause?.code || err.message), ms: Date.now() - started };
  }
}

// ---------------------------------------------------------------- link check

export interface LinkResult {
  url: string;
  ok: boolean;
  status: number | null;
  finalUrl: string | null;
  problem: string | null;
  /** Content paths that use this URL, e.g. `site.footer.shopLinks[0].href`. */
  usedIn: string[];
}

function collectLinks(value: unknown, path: string, out: Map<string, string[]>): void {
  if (typeof value === 'string') {
    const urls = value.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
    for (const url of urls) {
      const list = out.get(url) ?? [];
      list.push(path);
      out.set(url, list);
    }
  } else if (Array.isArray(value)) value.forEach((item, i) => collectLinks(item, `${path}[${i}]`, out));
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) if (!key.startsWith('_')) collectLinks(item, path ? `${path}.${key}` : key, out);
  }
}

/** Follows redirects by hand so a redirect to the shop's /404 page counts as dead. */
async function probe(url: string): Promise<Omit<LinkResult, 'usedIn'>> {
  let current = url;
  for (let hop = 0; hop < 6; hop += 1) {
    let res: Response;
    try {
      res = await fetch(current, {
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; dtf-transferprint-linkcheck)', accept: 'text/html,*/*' },
      });
    } catch (error) {
      const err = error as Error & { cause?: { code?: string } };
      return { url, ok: false, status: null, finalUrl: current, problem: err.name === 'TimeoutError' ? 'keine Antwort (10 s)' : `nicht erreichbar (${err.cause?.code || err.message})` };
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      await res.body?.cancel();
      current = new URL(res.headers.get('location')!, current).toString();
      if (/\/404\/?$|\/not-found\/?$/i.test(new URL(current).pathname)) return { url, ok: false, status: res.status, finalUrl: current, problem: 'leitet auf die 404-Seite um' };
      continue;
    }
    const isHtml = (res.headers.get('content-type') || '').includes('html');
    const body = isHtml ? (await res.text()).slice(0, 100_000) : (await res.body?.cancel(), '');
    if (res.status >= 400) return { url, ok: false, status: res.status, finalUrl: current, problem: `Fehler ${res.status}` };
    if (isHtml && /<title>[^<]*(404|nicht gefunden|not found)[^<]*<\/title>/i.test(body)) return { url, ok: false, status: res.status, finalUrl: current, problem: 'Seite meldet „nicht gefunden“' };
    return { url, ok: true, status: res.status, finalUrl: current === url ? null : current, problem: null };
  }
  return { url, ok: false, status: null, finalUrl: current, problem: 'zu viele Weiterleitungen' };
}

/**
 * Tests every http(s) link in the saved draft (shop links, social profiles, Google, WhatsApp …).
 * Social networks often block automated checks, so only own domains count as errors; others are hints.
 */
export async function checkLinks(): Promise<LinkResult[]> {
  const { draft } = await contentState();
  const links = new Map<string, string[]>();
  collectLinks(draft, '', links);
  const entries = [...links];
  const results: LinkResult[] = [];
  const queue = [...entries];
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const [url, usedIn] = next;
        results.push({ ...(await probe(url)), usedIn });
      }
    }),
  );
  const own = (url: string) => /(^|\.)(selini-shirt\.de|dtf-transferprint\.de|byselini\.de)$/i.test(new URL(url).hostname);
  return results
    .map((r) => (r.ok || own(r.url) ? r : { ...r, ok: true, problem: `${r.problem} – externe Seite, bitte von Hand prüfen` }))
    .sort((a, b) => Number(a.ok) - Number(b.ok) || Number(!a.problem) - Number(!b.problem) || a.url.localeCompare(b.url));
}

// ---------------------------------------------------------------- media

/** Netlify functions accept request bodies up to ~6 MB; leave room for encoding overhead. */
export const MAX_UPLOAD = 4 * 1024 * 1024;
const MAX_WIDTH = 1920;

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/\.[a-z0-9]+$/, '')
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50) || 'bild'
  );
}

/** Bundled images (public/images) plus uploads, newest uploads first. */
export async function listMedia() {
  const uploads = await query<{ path: string; size: number; width: number; height: number; created_at: Date }>(
    'SELECT path, size, width, height, created_at FROM media WHERE site_id = $1 ORDER BY created_at DESC',
    [SITE_ID],
  );
  return [...uploads.map((row) => ({ ...row, origin: 'upload' })), ...bundledImages.map((image) => ({ ...image, origin: 'bundled' }))];
}

/**
 * Every upload is re-encoded to WebP (max. 1920 px wide). That strips metadata such as EXIF/GPS and
 * guarantees the stored bytes are a real raster image; SVG is refused because it can carry scripts.
 */
export async function uploadImage(user: AdminUser, originalName: string, buffer: Buffer) {
  if (buffer.length > MAX_UPLOAD) throw new HttpError(413, 'Datei zu groß (max. 4 MB). Bitte das Bild vorher verkleinern.');
  let format: string | undefined;
  try {
    format = (await sharp(buffer, { limitInputPixels: 60_000_000 }).metadata()).format;
  } catch {
    throw new HttpError(400, 'Das ist kein unterstütztes Bild (JPG, PNG, WebP, AVIF).');
  }
  if (!format || !['jpeg', 'png', 'webp', 'avif', 'heif', 'gif'].includes(format)) {
    throw new HttpError(400, 'Bitte JPG, PNG, WebP oder AVIF hochladen (SVG ist aus Sicherheitsgründen gesperrt).');
  }
  const { data, info } = await sharp(buffer, { limitInputPixels: 60_000_000 })
    .rotate()
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });

  const base = slugify(originalName);
  const taken = new Set(
    (await query<{ path: string }>('SELECT path FROM media WHERE site_id = $1 AND path LIKE $2', [SITE_ID, `/images/cms/${base}%`])).map((row) => row.path),
  );
  let path = `/images/cms/${base}.webp`;
  for (let i = 2; taken.has(path) || bundledImages.some((image) => image.path === path); i += 1) path = `/images/cms/${base}-${i}.webp`;

  await query('INSERT INTO media (site_id, path, mime, size, sha256, width, height, data, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [
    SITE_ID,
    path,
    'image/webp',
    data.length,
    createHash('sha256').update(data).digest('hex'),
    info.width,
    info.height,
    data,
    user.email,
  ]);
  return { url: path, width: info.width, height: info.height };
}

export async function getMedia(path: string) {
  const [row] = await query<{ mime: string; data: Buffer; sha256: string }>('SELECT mime, data, sha256 FROM media WHERE site_id = $1 AND path = $2', [SITE_ID, path]);
  return row ?? null;
}
