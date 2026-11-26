import cmsData from '../data/cms.json';

/**
 * The bundled content. It is the schema for everything the admin may edit (field names, types,
 * labels and hints) and the fallback when the database is not reachable. Live content is the
 * latest version published in the admin (/admin), see src/lib/content.ts.
 */
export const REFERENCE = cmsData;
export type Cms = typeof cmsData;

/** Removes the admin metadata keys (`_label`, `_help`, `_hints`, `_path`) from a cms.json type. */
export type StripMeta<T> = T extends readonly (infer U)[]
  ? StripMeta<U>[]
  : T extends object
    ? { [K in keyof T as K extends `_${string}` ? never : K]: StripMeta<T[K]> }
    : T;

/** Deep copy of a cms.json object without its `_…` metadata keys. */
export function stripMeta<T>(value: T): StripMeta<T> {
  if (Array.isArray(value)) return value.map((item) => stripMeta(item)) as StripMeta<T>;
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !key.startsWith('_'))
        .map(([key, item]) => [key, stripMeta(item)]),
    ) as StripMeta<T>;
  }
  return value as StripMeta<T>;
}

/** Fills `{token}` placeholders of a cms.json template. Unknown tokens are left untouched so they get noticed. */
export function fill(template: string, tokens: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (key in tokens ? String(tokens[key]) : match));
}
