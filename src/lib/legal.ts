/**
 * Legal facts and the legal pages of this site. They live in code, not in cms.json: the routes are
 * code, and register data must not change by accident in the admin. Address, phone and e-mail come
 * from the company data in cms.json (`shared.company`).
 *
 * Source of the company facts: https://selini-shirt.de/rechtliches/impressum (same company).
 */
export const LEGAL_ENTITY = {
  name: 'BYSELINI UG (haftungsbeschränkt)',
  managingDirector: 'Gerasimos Katerelos',
  registerCourt: 'Amtsgericht Charlottenburg (Berlin)',
  registerNumber: 'HRB 234658 B',
  vatId: 'DE347598171',
  country: 'Deutschland',
  domain: 'dtf-transferprint.de',
} as const;

/** Shown as "Stand" on every legal page. Update when a legal text changes. */
export const LEGAL_UPDATED = { label: 'November 2026', iso: '2026-11-26' } as const;

export interface LegalLink {
  label: string;
  href: string;
  /** Leaves this site (the shop's own document). */
  external?: boolean;
}

/** The legal pages of this site, in the order of the tab bar. */
export const LEGAL_PAGES: LegalLink[] = [
  { label: 'Impressum', href: '/impressum' },
  { label: 'Datenschutz', href: '/datenschutz' },
  { label: 'Cookies', href: '/cookies' },
  { label: 'Nutzungsbedingungen', href: '/nutzungsbedingungen' },
];

/** Orders are placed in the shop, so its terms apply to them. */
export const SHOP_TERMS_URL = 'https://selini-shirt.de/rechtliches/agb';

/** Footer column "Rechtliches". */
export const LEGAL_LINKS: LegalLink[] = [...LEGAL_PAGES, { label: 'AGB (Shop)', href: SHOP_TERMS_URL, external: true }];
