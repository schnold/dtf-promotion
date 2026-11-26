/**
 * Content validation for the admin. The bundled cms.json is the schema: an edit may change values
 * and reorder/add/remove list items, but never invent keys, change types or touch metadata
 * (`_label`, `_path`, `_help`, `_hints`). Inline HTML is reduced to a small allowlist; links and
 * image paths are checked. (Ported from the former content dashboard, dashboard/lib/content.mjs.)
 */

export class ValidationError extends Error {
  status = 400;
  constructor(message: string, path?: string) {
    super(path ? `${message} (Feld: ${path})` : message);
  }
}

type Json = any;

const isObj = (v: unknown): v is Record<string, Json> => v !== null && typeof v === 'object' && !Array.isArray(v);
const isMeta = (k: string) => k.startsWith('_');
const MAX_STRING = 20_000;
const MAX_ITEMS = 300;
const MAX_DEPTH = 24;
export const MAX_JSON_BYTES = 2 * 1024 * 1024;

// ---------------------------------------------------------------- shapes

type Shape =
  | { kind: 'empty' }
  | { kind: 'array'; item: Shape }
  | { kind: 'object'; fields: Record<string, { shape: Shape; required: boolean }> }
  | { kind: 'meta'; value: Json }
  | { kind: 'number' }
  | { kind: 'boolean' }
  | { kind: 'string'; nullable?: boolean; samples: string[] };

/** Merge the shapes of several reference values (used for array item templates). */
function mergeShape(values: Json[]): Shape {
  const present = values.filter((v) => v !== undefined);
  if (!present.length) return { kind: 'empty' };
  const first = present[0];
  if (Array.isArray(first)) return { kind: 'array', item: mergeShape(present.flatMap((v) => (Array.isArray(v) ? v : []))) };
  if (isObj(first)) {
    const objs = present.filter(isObj);
    const keys = [...new Set(objs.flatMap((o) => Object.keys(o)))];
    const fields: Record<string, { shape: Shape; required: boolean }> = {};
    for (const k of keys) {
      const vals = objs.map((o) => o[k]);
      fields[k] = {
        shape: isMeta(k) ? { kind: 'meta', value: vals.find((v) => v !== undefined) } : mergeShape(vals),
        required: vals.every((v) => v !== undefined),
      };
    }
    return { kind: 'object', fields };
  }
  if (typeof first === 'number') return { kind: 'number' };
  if (typeof first === 'boolean') return { kind: 'boolean' };
  if (first === null) return { kind: 'string', nullable: true, samples: [] };
  return { kind: 'string', samples: present.filter((v): v is string => typeof v === 'string') };
}

// ---------------------------------------------------------------- strings

const SAFE_URL = /^(https?:\/\/[^\s<>"']+|mailto:[^\s<>"']+|tel:\+?[\d\s()/-]+|\/[^\s<>"']*|#[\w-]*|)$/i;
const UNSAFE_SCHEME = /^(javascript|data|vbscript):/i;
const ALLOWED_TAGS = new Set(['a', 'strong', 'em', 'b', 'i', 'br', 'code']);

const escapeAttr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Keep only <a href rel target>, <strong>, <em>, <b>, <i>, <br>, <code>; drop every other tag. */
export function sanitizeInline(value: string, path?: string): string {
  if (!/<\/?[a-z!]/i.test(value)) return value;
  if (/<\s*(script|style|iframe|object|embed|svg|math|template)\b/i.test(value)) throw new ValidationError('Unerlaubter HTML-Code', path);
  return value
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<\s*(\/?)\s*([a-z][a-z0-9]*)\b([^>]*)>/gi, (_, close: string, tagRaw: string, attrs: string) => {
      const tag = tagRaw.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) return '';
      if (close) return tag === 'br' ? '' : `</${tag}>`;
      if (tag !== 'a') return tag === 'br' ? '<br>' : `<${tag}>`;
      const out: string[] = [];
      const re = /([a-z-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(attrs))) {
        const name = m[1].toLowerCase();
        const val = (m[3] ?? m[4] ?? m[5] ?? '').trim();
        if (name === 'href') {
          if (!SAFE_URL.test(val) || UNSAFE_SCHEME.test(val)) throw new ValidationError(`Unsicherer Link „${val.slice(0, 60)}“`, path);
          out.push(`href="${escapeAttr(val)}"`);
        } else if (name === 'rel' && /^[a-z\s]+$/i.test(val)) out.push(`rel="${val}"`);
        else if (name === 'target' && /^_(blank|self)$/.test(val)) out.push(`target="${val}"`);
      }
      return `<a${out.length ? ` ${out.join(' ')}` : ''}>`;
    });
}

function checkString(key: string | number, value: Json, shape: Extract<Shape, { kind: 'string' }>, path: string): string {
  if (typeof value !== 'string') throw new ValidationError('Text erwartet', path);
  if (value.length > MAX_STRING) throw new ValidationError(`Text zu lang (max. ${MAX_STRING} Zeichen)`, path);
  // eslint-disable-next-line no-control-regex
  const v = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  if (key === 'liveUrl') {
    if (v.trim() === '') return '';
    let url: URL;
    try {
      url = new URL(/^https?:\/\//i.test(v.trim()) ? v.trim() : `https://${v.trim()}`);
    } catch {
      throw new ValidationError('Ungültige Live-URL', path);
    }
    return url.origin;
  }
  // A field is a link when the reference holds link values there (or it is literally called href/url).
  const samples = shape.samples.filter(Boolean);
  const urlLike = (samples.length > 0 && samples.every((x) => /^(https?:\/\/|mailto:|tel:|\/|#)\S*$/.test(x))) || /^(href|url|ctaHref|shopUrl)$/.test(String(key));
  if (urlLike && (!SAFE_URL.test(v.trim()) || UNSAFE_SCHEME.test(v.trim()))) throw new ValidationError(`Ungültiger Link „${v.slice(0, 60)}“`, path);
  const imageLike = shape.samples.some((s) => /^\/images\//.test(s));
  if ((imageLike || key === 'src') && v && !(/^\/images\/[\w./-]+$/.test(v) && !v.includes('..')) && !shape.samples.includes(v)) {
    throw new ValidationError('Bildpfad muss mit /images/ beginnen', path);
  }
  return sanitizeInline(v, path);
}

// ---------------------------------------------------------------- validate

function validateNode(shape: Shape, value: Json, path: string, depth: number, key: string | number, inArray = false): Json {
  if (depth > MAX_DEPTH) throw new ValidationError('Zu tief verschachtelt', path);
  switch (shape.kind) {
    case 'string':
      if (value === null && shape.nullable) return null;
      return checkString(key, value, shape, path);
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e12) throw new ValidationError('Zahl erwartet', path);
      return value;
    case 'boolean':
      if (typeof value !== 'boolean') throw new ValidationError('Ja/Nein erwartet', path);
      return value;
    case 'array': {
      if (!Array.isArray(value)) throw new ValidationError('Liste erwartet', path);
      if (value.length > MAX_ITEMS) throw new ValidationError(`Zu viele Einträge (max. ${MAX_ITEMS})`, path);
      if (shape.item.kind === 'empty') {
        if (value.length) throw new ValidationError('Diese Liste kann im Admin nicht befüllt werden', path);
        return [];
      }
      return value.map((item, i) => validateNode(shape.item, item, `${path}[${i}]`, depth + 1, i, true));
    }
    case 'object': {
      if (!isObj(value)) throw new ValidationError('Objekt erwartet', path);
      const out: Record<string, Json> = {};
      for (const k of Object.keys(value)) {
        if (!(k in shape.fields)) throw new ValidationError(`Unbekanntes Feld „${k}“`, path);
      }
      for (const [k, field] of Object.entries(shape.fields)) {
        if (field.shape.kind === 'meta') {
          // Metadata comes from the reference. List items may carry their own labels (they move
          // with the item when reordered), so there only plain, short text is accepted.
          if (inArray) {
            if (typeof value[k] === 'string' && value[k].length <= 300) out[k] = value[k].replace(/<[^>]*>/g, '');
            else if (field.required) out[k] = field.shape.value;
          } else if (field.required || value[k] !== undefined) out[k] = field.shape.value;
          continue;
        }
        if (value[k] === undefined) {
          if (field.required) throw new ValidationError(`Feld „${k}“ fehlt`, path);
          continue;
        }
        out[k] = validateNode(field.shape, value[k], path ? `${path}.${k}` : k, depth + 1, k);
      }
      return out;
    }
    default:
      throw new ValidationError('Unerwarteter Wert', path);
  }
}

export function validateContent<T>(reference: T, value: unknown): T {
  const size = new TextEncoder().encode(JSON.stringify(value ?? null)).length;
  if (size > MAX_JSON_BYTES) throw new ValidationError('Inhalt zu groß');
  return validateNode(mergeShape([reference]), value, '', 0, '') as T;
}

// ---------------------------------------------------------------- sync

/**
 * Bring stored content in line with a newer reference: new fields get the reference value,
 * removed fields disappear, metadata is refreshed. Values the editor changed are kept.
 */
export function syncToReference<T>(ref: T, value: unknown): T {
  const r = ref as Json;
  if (Array.isArray(r)) {
    if (!Array.isArray(value)) return structuredClone(ref);
    if (!r.length) return [] as T;
    const template = r[0];
    return value.map((item, i) => syncToReference(r[i] ?? template, item)) as T;
  }
  if (isObj(r)) {
    if (!isObj(value)) return structuredClone(ref);
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(r)) out[k] = isMeta(k) ? v : k in value ? syncToReference(v, value[k]) : structuredClone(v);
    return out as T;
  }
  if (typeof r === 'number') return (typeof value === 'number' ? value : r) as T;
  if (typeof r === 'boolean') return (typeof value === 'boolean' ? value : r) as T;
  if (typeof r === 'string' || r === null) return (typeof value === 'string' || value === null ? value : r) as T;
  return value as T;
}

export const sameContent = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
