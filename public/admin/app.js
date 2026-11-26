/* DTF Transferprint Admin — client. Schema-driven editor for src/data/cms.json content: drafts,
   instant publishing, version history, audit log and account handling. No framework.
   (Ported from the former Selini Content-Dashboard.) */

// ------------------------------------------------------------------ utilities

const $ = (sel, root = document) => root.querySelector(sel);

function h(tag, attrs = {}, ...children) {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name || 'div');
  if (classes.length) el.className = classes.join(' ');
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = [el.className, value].filter(Boolean).join(' ');
    else if (key === 'style' && typeof value === 'object') {
      // CSSOM (not the style attribute), so the strict CSP stays intact; custom properties need setProperty.
      for (const [prop, v] of Object.entries(value)) prop.startsWith('--') ? el.style.setProperty(prop, v) : (el.style[prop] = v);
    } else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else if (value === true) el.setAttribute(key, '');
    else el.setAttribute(key, value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return el;
}

const clone = (value) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isMeta = (key) => typeof key === 'string' && key.startsWith('_');
const IMAGE_RE = /\.(png|jpe?g|webp|avif|svg|gif)$/i;
const isImageObj = (v) => isObj(v) && typeof v.src === 'string';
const isImagePath = (v) => typeof v === 'string' && v.startsWith('/images/') && IMAGE_RE.test(v);
const hasHtml = (v) => typeof v === 'string' && /<(a|strong|em|br|code|b|i)\b/i.test(v);
const stripHtml = (v) => String(v).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const pathKey = (path) => path.join('.');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function getIn(obj, path) {
  let cur = obj;
  for (const key of path) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[key];
  }
  return cur;
}
function setIn(obj, path, value) {
  let cur = obj;
  for (const key of path.slice(0, -1)) cur = cur[key];
  cur[path[path.length - 1]] = value;
}

function flatten(value, path = [], out = new Map()) {
  if (Array.isArray(value)) {
    if (!value.length) out.set(pathKey(path), '[]');
    value.forEach((item, i) => flatten(item, [...path, i], out));
  } else if (isObj(value)) {
    for (const [k, v] of Object.entries(value)) if (!isMeta(k)) flatten(v, [...path, k], out);
  } else out.set(pathKey(path), value);
  return out;
}
function diffCount(a, b) {
  const fa = flatten(a);
  const fb = flatten(b);
  let n = 0;
  for (const [k, v] of fa) if (!fb.has(k) || fb.get(k) !== v) n += 1;
  for (const k of fb.keys()) if (!fa.has(k)) n += 1;
  return n;
}

async function api(url, options = {}) {
  const isJson = options.body !== undefined && !(options.body instanceof Blob);
  const res = await fetch(url, {
    ...options,
    credentials: 'same-origin',
    body: isJson ? JSON.stringify(options.body) : options.body,
    headers: { 'x-admin': '1', ...(isJson ? { 'content-type': 'application/json' } : {}), ...(options.headers || {}) },
  });
  if (res.status === 401) {
    location.replace('/admin/login');
    throw new Error('Sitzung abgelaufen');
  }
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw Object.assign(new Error((data && data.error) || data || res.statusText), { status: res.status });
  return data;
}

function toast(message, { kind = '', action, timeout = 5000 } = {}) {
  const el = h('div.toast', { class: kind }, h('span', {}, message));
  if (action) el.append(h('button.btn.btn-small', { type: 'button', onclick: () => { el.remove(); action.fn(); } }, action.label));
  $('#toasts').append(el);
  if (timeout) setTimeout(() => el.remove(), timeout);
}

const dateFmt = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
/** Accepts epoch milliseconds or ISO date strings (the API sends database timestamps as ISO). */
const when = (value) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? dateFmt.format(date) : '–';
};

// ------------------------------------------------------------------ labels

const LABELS = {
  liveUrl: 'Live-URL', name: 'Name', title: 'Titel', subtitle: 'Untertitel', description: 'Beschreibung',
  metaTitle: 'SEO-Titel (Google)', metaDescription: 'Meta-Beschreibung (Google)', seoTitle: 'SEO-Titel (Google)', seoDescription: 'Meta-Beschreibung (Google)',
  seo: 'SEO', h1: 'Hauptüberschrift (H1)', h2: 'Zwischenüberschrift (H2)', h3: 'Überschrift (H3)', heading: 'Überschrift', headline: 'Überschrift',
  eyebrow: 'Dachzeile (über der Überschrift)', kicker: 'Dachzeile', lead: 'Einleitung', intro: 'Einleitung', text: 'Text', body: 'Text', paragraphs: 'Absätze',
  content: 'Inhalt', summary: 'Kurzfassung', answer: 'Antwort', question: 'Frage', items: 'Einträge', faq: 'FAQ',
  label: 'Beschriftung', href: 'Link-Ziel', url: 'URL', link: 'Link', anchor: 'Linktext', cta: 'Handlungsaufruf (CTA)', ctaLabel: 'Button-Text', ctaHref: 'Button-Link',
  button: 'Button', buttonLabel: 'Button-Text', note: 'Hinweis', notes: 'Hinweise', caption: 'Bildunterschrift', teaser: 'Kurztext (Karte)',
  image: 'Bild', images: 'Bilder', src: 'Bilddatei', alt: 'Alternativtext (Google & Screenreader)', width: 'Breite (px)', height: 'Höhe (px)',
  ogImage: 'Vorschaubild für Social Media', ogImageAlt: 'Alt-Text Vorschaubild',
  price: 'Preis', prices: 'Preise', priceValue: 'Preis (Zahl)', priceNote: 'Preis-Hinweis', pricePerMeter: 'Preis pro Meter (€)', basePricePerMeter: 'Grundpreis pro Meter (€)',
  unitPrice: 'Stückpreis (€)', minMeters: 'ab Meter', quantity: 'Menge', minQuantity: 'Mindestmenge', tiers: 'Staffelpreise', bundles: 'Bundles', meters: 'Meter',
  rollWidthCm: 'Rollenbreite (cm)', widthCm: 'Breite (cm)', heightCm: 'Höhe (cm)', priceUpdatedLabel: 'Preisstand (Text)', lastmod: 'Zuletzt geändert (Sitemap)',
  company: 'Firmendaten', legalName: 'Firmierung', brand: 'Marke', street: 'Straße', postalCode: 'PLZ', city: 'Ort', district: 'Bezirk',
  phone: 'Telefon (Anzeige)', phoneDisplay: 'Telefon (Anzeige)', phoneHref: 'Telefon-Link', phoneE164: 'Telefon (international)', email: 'E-Mail', whatsapp: 'WhatsApp-Link',
  googleRating: 'Google-Bewertung (Text)', googleRatingValue: 'Google-Bewertung (Zahl)', googleUrl: 'Google-Profil', googleRatingUrl: 'Google-Profil',
  socials: 'Social Media', social: 'Social Media', sameAs: 'Profile (sameAs)', shop: 'Shop-Links', links: 'Links', legal: 'Rechtliches', nav: 'Navigation',
  navLabel: 'Name im Menü', footer: 'Fußzeile', path: 'Pfad', key: 'Schlüssel', value: 'Wert', spec: 'Eckdaten', specs: 'Eckdaten', steps: 'Schritte', step: 'Schritt',
  rows: 'Tabellenzeilen', columns: 'Spalten', cards: 'Karten', features: 'Merkmale', benefits: 'Vorteile', bullets: 'Aufzählung', list: 'Liste',
  temperature: 'Temperatur', time: 'Zeit', pressure: 'Druck', short: 'Kurzbeschreibung', shopUrl: 'Shop-Link', shopAnchor: 'Shop-Linktext',
  claim: 'Claim', since: 'Erfahrung', tagline: 'Slogan', hero: 'Hero (oberster Bereich)',
  // DTF Transferprint (shared.pricing and page sections)
  maxQuantity: 'Höchste Anzahl im Preisrechner', experienceYears: 'Jahre Erfahrung', deliveryLabel: 'Lieferzeit (Text)', recommendedDpi: 'Empfohlene Auflösung (dpi)',
  locationLabel: 'Produktionsort', formats: 'Formate & Stückpreise', pricing: 'Preise & Staffeln', ticker: 'Laufband', facts: 'Eckdaten', pressing: 'Pressen',
  files: 'Druckdaten', comparison: 'Vergleich', audiences: 'Zielgruppen', production: 'Produktion', structuredData: 'Strukturierte Daten (Google)',
  icon: 'Symbol', titleTemplate: 'SEO-Titel (Vorlage)', descriptionTemplate: 'Meta-Beschreibung (Vorlage)', skipLink: 'Sprunglink (Barrierefreiheit)',
  logo: 'Logo-Text', header: 'Kopfzeile', shopLinks: 'Shop-Links', copyright: 'Copyright-Zeile', madeIn: 'Made in …',
};
function humanize(key) {
  if (typeof key === 'number') return `Eintrag ${key + 1}`;
  const words = String(key).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
const labelFor = (key, obj) => (isObj(obj) && obj._label) || LABELS[key] || humanize(key);
const LONG_KEYS = new Set(['lead', 'intro', 'text', 'body', 'answer', 'description', 'metaDescription', 'seoDescription', 'note', 'summary', 'teaser', 'caption', 'content', 'priceNote']);
function seoRule(key, parentKey) {
  if (['metaTitle', 'seoTitle'].includes(key) || (key === 'title' && parentKey === 'seo')) return { max: 60 };
  if (['metaDescription', 'seoDescription'].includes(key) || (key === 'description' && parentKey === 'seo')) return { min: 140, max: 160 };
  return null;
}

// ------------------------------------------------------------------ state

const S = { me: null, sites: [], site: {}, route: { name: 'overview' }, pendingFocus: null, live: {} };
const siteState = (id) => (S.site[id] ||= { openItems: new Set(), search: '' });
const dirtyCount = (id) => {
  const st = S.site[id];
  return st?.data ? diffCount(st.saved, st.data) : 0;
};

function refreshDirtyUi() {
  for (const site of S.sites) {
    const badge = document.querySelector(`[data-tab-badge="${site.id}"]`);
    const n = dirtyCount(site.id);
    if (badge) {
      badge.hidden = !n;
      badge.textContent = n;
    }
  }
  const n = S.route.site ? dirtyCount(S.route.site) : 0;
  $('#savebar').hidden = !n;
  $('#savebar-text').textContent = n === 1 ? '1 Änderung nicht gespeichert' : `${n} Änderungen nicht gespeichert`;
}

// ------------------------------------------------------------------ routing

function parseRoute() {
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 's' && parts[1]) return { name: 'site', site: parts[1], view: parts.slice(2).join('/') || '' };
  if (parts[0] === 'protokoll') return { name: 'audit' };
  if (parts[0] === 'benutzer') return { name: 'users' };
  return { name: 'overview' };
}
function go(siteId, view = '') {
  const hash = `#/s/${encodeURIComponent(siteId)}${view ? `/${view.split('/').map(encodeURIComponent).join('/')}` : ''}`;
  if (location.hash === hash) render();
  else location.hash = hash;
}
window.addEventListener('hashchange', () => render());

// ------------------------------------------------------------------ boot

async function boot() {
  try {
    [S.me, S.sites] = await Promise.all([api('/admin/api/me'), api('/admin/api/sites')]);
  } catch (error) {
    $('#app').replaceChildren(h('div.empty-state', {}, `Admin nicht erreichbar: ${error.message}`));
    return;
  }
  $('#user-chip').textContent = `${S.me.name} · ${S.me.role === 'admin' ? 'Admin' : 'Redaktion'}`;
  render();
  for (const site of S.sites) checkLive(site.id);
}

async function refreshSites() {
  S.sites = await api('/admin/api/sites');
}

async function checkLive(id) {
  S.live[id] = { state: 'checking' };
  updateLiveStatus(id);
  try {
    S.live[id] = await api(`/admin/api/sites/${id}/live-check`);
  } catch (error) {
    S.live[id] = { state: 'down', error: error.message };
  }
  updateLiveStatus(id);
}

function liveStatusNode(id) {
  const r = S.live[id] || { state: 'checking' };
  const site = S.sites.find((s) => s.id === id);
  const host = (u) => {
    try {
      return new URL(u).hostname.replace(/^www\./, '');
    } catch {
      return '';
    }
  };
  if (r.state === 'checking') return [h('span.pill.pill-muted', {}, 'prüfe …')];
  if (r.state === 'unset') return [h('span.pill.pill-muted', {}, 'noch keine Live-URL'), h('span', {}, 'Tragen Sie die Domain ein, sobald die Seite online ist.')];
  if (r.state === 'up' && site?.liveUrl && r.finalUrl && host(r.finalUrl) !== host(site.liveUrl))
    return [h('span.pill.pill-warn', {}, `leitet weiter auf ${host(r.finalUrl)}`), h('span', {}, 'Prüfen Sie, ob die Domain auf diese Website zeigt.')];
  if (r.state === 'up')
    return [h('span.pill.pill-ok', {}, `online · ${r.status}`), h('span', {}, `${r.ms} ms`), r.title ? h('span', {}, `„${r.title}“`) : null,
      site?.liveUrl ? h('a', { href: site.liveUrl, target: '_blank', rel: 'noopener noreferrer' }, 'öffnen ↗') : null].filter(Boolean);
  if (r.state === 'error') return [h('span.pill.pill-warn', {}, `antwortet mit ${r.status}`)];
  return [h('span.pill.pill-bad', {}, 'nicht erreichbar'), h('span', {}, r.error || '')];
}
function updateLiveStatus(id) {
  document.querySelectorAll(`[data-live-status="${id}"]`).forEach((el) => el.replaceChildren(...liveStatusNode(id)));
}

// ------------------------------------------------------------------ render root

function render() {
  S.route = parseRoute();
  renderTabs();
  const app = $('#app');
  if (S.route.name === 'overview') {
    document.body.style.removeProperty('--accent');
    app.replaceChildren(renderOverview());
    refreshDirtyUi();
    return;
  }
  if (S.route.name === 'audit') {
    renderAudit();
    return;
  }
  if (S.route.name === 'users') {
    renderUsers();
    return;
  }
  const site = S.sites.find((s) => s.id === S.route.site);
  if (!site) {
    app.replaceChildren(h('div.empty-state', {}, 'Unbekannte Website.'));
    return;
  }
  document.body.style.setProperty('--accent', site.accent);
  renderSite(site);
}

function renderTabs() {
  const current = S.route.name === 'site' ? S.route.site : S.route.name;
  $('#tabs').replaceChildren(
    h('a.tab', { href: '#/', 'aria-current': current === 'overview' ? 'page' : null }, 'Übersicht'),
    ...S.sites.map((site) =>
      h('a.tab', { href: `#/s/${site.id}`, 'aria-current': current === site.id ? 'page' : null, style: { '--tab-accent': site.accent } },
        h('span.tab-dot', { 'aria-hidden': 'true' }), site.label, h('span.tab-badge', { 'data-tab-badge': site.id, hidden: true, title: 'ungespeicherte Änderungen' }))),
    S.me?.role === 'admin' ? h('a.tab', { href: '#/benutzer', 'aria-current': current === 'users' ? 'page' : null }, 'Benutzer') : null,
    S.me?.role === 'admin' ? h('a.tab', { href: '#/protokoll', 'aria-current': current === 'audit' ? 'page' : null }, 'Protokoll') : null,
  );
}

// ------------------------------------------------------------------ overview

function liveBox(site) {
  const input = h('input.input', { type: 'url', value: site.liveUrl || '', placeholder: 'https://www.ihre-domain.de', 'aria-label': `Live-URL ${site.label}`, spellcheck: 'false', id: `live-${site.id}` });
  const button = h('button.btn', { type: 'button' }, 'Übernehmen');
  const apply = async () => {
    button.disabled = true;
    try {
      const res = await api(`/admin/api/sites/${site.id}/live-url`, { method: 'PUT', body: { liveUrl: input.value } });
      input.value = res.liveUrl;
      site.liveUrl = res.liveUrl;
      const st = S.site[site.id];
      if (st?.data) st.loaded = false; // reload the draft, its rev changed
      toast(res.version ? `Live-URL gespeichert und veröffentlicht. ${res.build?.message || ''}` : 'Live-URL unverändert.', { timeout: 8000 });
      checkLive(site.id);
    } catch (error) {
      toast(error.message, { kind: 'bad' });
    } finally {
      button.disabled = false;
    }
  };
  button.addEventListener('click', apply);
  input.addEventListener('keydown', (e) => e.key === 'Enter' && apply());
  return h('div.live-box', {},
    h('label', { for: `live-${site.id}` }, 'Live-URL (Produktion)'),
    h('div.input-row', {}, input, button, h('button.btn.btn-ghost', { type: 'button', title: 'Erreichbarkeit erneut prüfen', onclick: () => checkLive(site.id) }, '↻')),
    h('div.live-status', { 'data-live-status': site.id }, ...liveStatusNode(site.id)));
}

function renderOverview() {
  const cards = S.sites.map((site) =>
    h('article.site-card', { style: { '--accent': site.accent } },
      h('div.site-card-bar'),
      h('div.site-card-body', {},
        h('div', {}, h('h2', {}, site.label), h('p.note', {}, site.note)),
        site.hasUnpublished ? h('div.notice', {}, `Unveröffentlichte Änderungen im Entwurf (zuletzt ${when(site.updatedAt)} von ${site.updatedBy || '–'}).`) : null,
        liveBox(site),
        h('div.stats', {},
          h('span', {}, 'Seiten: ', h('b', {}, site.pageCount)),
          h('span', {}, 'Online-Version: ', h('b', {}, `v${site.publishedVersion}`), ` vom ${when(site.publishedAt)}`),
        ),
        h('div.actions', {}, h('a.btn.btn-primary', { href: `#/s/${site.id}` }, 'Inhalte bearbeiten'), h('a.btn', { href: '/admin/preview', target: '_blank', rel: 'noopener' }, 'Entwurf ansehen ↗'), h('a.btn', { href: `#/s/${site.id}/versions` }, 'Versionen')))));

  return h('div.overview', {},
    h('div.overview-head', {},
      h('div', {}, h('h1', {}, 'Ihre Website'),
        h('p', {}, 'Hier ändern Sie alle Texte, Zahlen, Preise, Links und Bilder der Seite. Änderungen werden erst nach „Veröffentlichen“ sichtbar – dann aber sofort.'))),
    h('div.site-grid', {}, cards),
    h('ol.steps', {},
      h('li', {}, h('strong', {}, 'Bearbeiten'), 'Tab wählen, Seite links anklicken, Text oder Bild ändern. Geänderte Felder werden gelb markiert.'),
      h('li', {}, h('strong', {}, 'Entwurf speichern'), 'Sichert Ihre Arbeit. Online ändert sich noch nichts – Sie können jederzeit weitermachen.'),
      h('li', {}, h('strong', {}, 'Vorschau & Veröffentlichen'), '„Entwurf ansehen“ zeigt den gespeicherten Entwurf wie die echte Seite. „Veröffentlichen“ stellt ihn sofort online.'),
      h('li', {}, h('strong', {}, 'Zurückholen'), 'Jede veröffentlichte Version bleibt gespeichert und lässt sich unter „Versionen“ wiederherstellen.')));
}

// ------------------------------------------------------------------ audit

async function renderAudit() {
  const app = $('#app');
  app.replaceChildren(h('div.overview', {}, h('div.empty-state', {}, 'lade Protokoll …')));
  let rows;
  try {
    rows = await api('/admin/api/audit');
  } catch (error) {
    app.replaceChildren(h('div.overview', {}, h('div.notice', {}, error.message)));
    return;
  }
  const NAMES = {
    login: 'Anmeldung', logout: 'Abmeldung', login_failed: 'Fehlversuch', login_blocked: 'Anmeldung blockiert', login_throttled: 'Zu viele Versuche', lockout: 'Konto gesperrt',
    totp_enrolled: '2FA eingerichtet', password_changed: 'Passwort geändert', save_draft: 'Entwurf gespeichert', publish: 'Veröffentlicht', discard_draft: 'Entwurf verworfen',
    restore_version: 'Version wiederhergestellt', live_url: 'Live-URL geändert', upload: 'Bild hochgeladen', user_created: 'Konto angelegt', password_reset: 'Passwort zurückgesetzt',
    totp_reset: '2FA zurückgesetzt', totp_disabled: '2FA ausgeschaltet', user_deleted: 'Konto gelöscht', role_changed: 'Rolle geändert', unlock: 'Entsperrt', user_disabled: 'Konto deaktiviert', user_enabled: 'Konto aktiviert',
    setup_admin: 'Admin-Konto angelegt',
  };
  app.replaceChildren(h('div.overview', {},
    h('div.overview-head', {}, h('div', {}, h('h1', {}, 'Protokoll'), h('p', {}, 'Die letzten 300 Ereignisse: Anmeldungen, Änderungen, Veröffentlichungen.'))),
    h('section.card', {}, h('div.card-body', {}, h('table.audit-table', {},
      h('thead', {}, h('tr', {}, h('th', {}, 'Zeit'), h('th', {}, 'Wer'), h('th', {}, 'Ereignis'), h('th', {}, 'Website'), h('th', {}, 'Details'), h('th', {}, 'IP'))),
      h('tbody', {}, rows.map((r) => h('tr', {},
        h('td', {}, when(r.at)), h('td', {}, r.user_email || '–'),
        h('td', {}, h('span.pill', { class: /fail|lock|block|thrott/.test(r.action) ? 'pill-bad' : r.action === 'publish' ? 'pill-ok' : '' }, NAMES[r.action] || r.action)),
        h('td', {}, S.sites.find((s) => s.id === r.site_id)?.label || r.site_id || ''), h('td.mono', {}, r.detail || ''), h('td.mono', {}, r.ip || '')))))))));
}

// ------------------------------------------------------------------ people (admins only)

const ROLE_NAMES = { admin: 'Admin', editor: 'Redaktion' };

function roleSelect(value, attrs = {}) {
  return h('select', attrs, Object.entries(ROLE_NAMES).map(([key, label]) => h('option', { value: key, selected: key === value }, label)));
}

/** Small dialog for setting someone's password (no browser prompt, the input stays masked). */
function askPassword(name) {
  return new Promise((resolve) => {
    const input = h('input.input', { type: 'password', minlength: '12', required: true, autocomplete: 'new-password', id: 'reset-pw' });
    const dialog = h('dialog.modal', { id: 'reset-dialog' },
      h('form.modal-head', { method: 'dialog' }, h('h2', {}, `Neues Passwort für ${name}`), h('span.savebar-spacer'), h('button.btn.btn-ghost', { value: 'cancel', 'aria-label': 'Schließen' }, '✕')),
      h('form.card-body.account-form', {
        onsubmit: (event) => {
          event.preventDefault();
          resolve(input.value);
          dialog.close();
        },
      },
      h('p.card-help', {}, 'Mindestens 12 Zeichen. Die Person wird überall abgemeldet; teilen Sie ihr das Passwort auf sicherem Weg mit.'),
      h('div.field', {}, h('label.field-label', { for: 'reset-pw' }, 'Neues Passwort'), input),
      h('div.list-foot', {}, h('button.btn.btn-primary', { type: 'submit' }, 'Passwort setzen'))));
    dialog.addEventListener('close', () => {
      dialog.remove();
      resolve(null);
    });
    dialog.style.width = 'min(480px, calc(100vw - 32px))';
    document.body.append(dialog);
    dialog.showModal();
    input.focus();
  });
}

async function renderUsers() {
  const app = $('#app');
  app.replaceChildren(h('div.overview', {}, h('div.empty-state', {}, 'lade Benutzer …')));
  let rows;
  try {
    rows = await api('/admin/api/users');
  } catch (error) {
    app.replaceChildren(h('div.overview', {}, h('div.notice', {}, error.message)));
    return;
  }
  const act = async (fn, done) => {
    try {
      await fn();
      toast(done, { timeout: 8000 });
      renderUsers();
      return true;
    } catch (error) {
      toast(error.message, { kind: 'bad' });
      return false;
    }
  };
  const userUrl = (u, rest = '') => `/admin/api/users/${encodeURIComponent(u.id)}${rest}`;

  const table = h('table.audit-table.users-table', {},
    h('thead', {}, h('tr', {}, h('th', {}, 'Name'), h('th', {}, 'E-Mail'), h('th', {}, 'Rolle'), h('th', {}, '2FA'), h('th', {}, 'Letzte Anmeldung'), h('th', {}, ''))),
    h('tbody', {}, rows.map((u) => {
      const self = u.id === S.me.id;
      const role = roleSelect(u.role, {
        'aria-label': `Rolle von ${u.name}`,
        disabled: self,
        onchange: (e) => act(() => api(userUrl(u, '/role'), { method: 'PUT', body: { role: e.target.value } }), 'Rolle geändert.'),
      });
      return h('tr', {},
        h('td', {}, u.name, self ? ' (Sie)' : ''),
        h('td.mono', {}, u.email),
        h('td', {}, role),
        h('td', {}, h('span.pill', { class: u.twoFactorEnabled ? 'pill-ok' : 'pill-muted' }, u.twoFactorEnabled ? 'an' : 'aus')),
        h('td', {}, u.lastLogin ? when(u.lastLogin) : '–'),
        h('td', {}, h('div.row-actions', {},
          self ? null : h('button.btn.btn-small', {
            type: 'button',
            onclick: async () => {
              const next = await askPassword(u.name);
              if (next) act(() => api(userUrl(u, '/password'), { method: 'POST', body: { password: next } }), `Neues Passwort für ${u.name} gesetzt.`);
            },
          }, 'Passwort setzen'),
          !self && u.twoFactorEnabled ? h('button.btn.btn-small', {
            type: 'button',
            onclick: () => {
              if (window.confirm(`2FA für ${u.name} ausschalten? Die Person meldet sich dann nur mit Passwort an und kann 2FA unter „Konto“ neu einrichten.`)) {
                act(() => api(userUrl(u, '/2fa-reset'), { method: 'POST', body: {} }), `2FA für ${u.name} ausgeschaltet.`);
              }
            },
          }, '2FA zurücksetzen') : null,
          self ? null : h('button.btn.btn-small.btn-danger', {
            type: 'button',
            onclick: () => {
              if (window.confirm(`Konto von ${u.name} (${u.email}) endgültig löschen?`)) act(() => api(userUrl(u), { method: 'DELETE' }), `Konto von ${u.name} gelöscht.`);
            },
          }, 'Löschen'))));
    })));

  const form = h('form.user-form', {},
    h('div.field', {}, h('label.field-label', { for: 'nu-name' }, 'Name'), h('input.input', { id: 'nu-name', name: 'name', required: true, autocomplete: 'off', maxlength: '100' })),
    h('div.field', {}, h('label.field-label', { for: 'nu-email' }, 'E-Mail'), h('input.input', { id: 'nu-email', name: 'email', type: 'email', required: true, autocomplete: 'off' })),
    h('div.field', {}, h('label.field-label', { for: 'nu-password' }, 'Start-Passwort (mind. 12 Zeichen)'), h('input.input', { id: 'nu-password', name: 'password', type: 'password', required: true, minlength: '12', autocomplete: 'new-password' })),
    h('div.field', {}, h('label.field-label', { for: 'nu-role' }, 'Rolle'), roleSelect('editor', { id: 'nu-role', name: 'role', class: 'input' })),
    h('div.field', {}, h('button.btn.btn-primary', { type: 'submit' }, 'Konto anlegen')));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const fd = new FormData(form);
    act(() => api('/admin/api/users', { method: 'POST', body: Object.fromEntries(fd) }), `Konto für ${fd.get('email')} angelegt. Die Person kann sich jetzt anmelden.`);
  });

  app.replaceChildren(h('div.overview', {},
    h('div.overview-head', {}, h('div', {}, h('h1', {}, 'Benutzer'),
      h('p', {}, '„Redaktion“ bearbeitet und veröffentlicht Inhalte. „Admin“ verwaltet zusätzlich die Benutzer und sieht das Protokoll.'))),
    h('section.card', {}, h('div.card-head', {}, h('h2', {}, 'Neues Konto')),
      h('p.card-help', {}, 'Die Person meldet sich sofort mit E-Mail und diesem Passwort an. Teilen Sie es auf sicherem Weg mit. Unter „Konto“ kann sie es ändern und die Zwei-Faktor-Anmeldung einschalten (optional).'),
      h('div.card-body', {}, form)),
    h('section.card', {}, h('div.card-body', {}, table))));
}

// ------------------------------------------------------------------ field rendering

function markChanged(doc, el, path) {
  el.classList.toggle('changed', !same(getIn(doc.root(), path), getIn(doc.orig(), path)));
}

function fieldShell(key, path, value) {
  const el = h('div.field', { 'data-path': pathKey(path) });
  if (typeof key !== 'number') {
    el.append(h('div.field-label', {}, h('span', {}, labelFor(key)),
      hasHtml(value) ? h('span.tag-html', { title: 'Enthält Links oder Hervorhebungen. Die <…>-Tags bitte stehen lassen.' }, 'HTML') : null));
  }
  return el;
}

function hintFor(key, parent, value) {
  const hints = [];
  if (isObj(parent) && parent._hints && parent._hints[key]) hints.push(parent._hints[key]);
  if (typeof value === 'string') {
    const tokens = [...new Set(value.match(/\{[a-zA-Z0-9_.]+\}/g) || [])];
    if (tokens.length) hints.push(`Platzhalter ${tokens.join(', ')} werden automatisch mit aktuellen Werten gefüllt – bitte nicht löschen.`);
  }
  return hints.length ? h('div.field-hint', {}, hints.join(' ')) : null;
}

function textControl(doc, key, path, value, el, parentKey) {
  const long = typeof key === 'number' ? value.length > 90 : value.length > 70 || value.includes('\n') || LONG_KEYS.has(key) || hasHtml(value);
  const control = long ? h('textarea.textarea', { rows: 2, spellcheck: 'true', lang: 'de' }) : h('input.input', { type: 'text', spellcheck: 'true', lang: 'de' });
  control.value = value;
  const rule = typeof key === 'string' ? seoRule(key, parentKey) : null;
  const counter = rule ? h('span.counter') : null;
  const updateCounter = () => {
    if (!counter) return;
    const len = stripHtml(control.value).length;
    counter.className = `counter ${rule.max && len > rule.max ? 'bad' : rule.min && len < rule.min ? 'warn' : 'ok'}`;
    counter.textContent = rule.min ? `${len} Zeichen · Ziel ${rule.min}–${rule.max}` : `${len} / ${rule.max} Zeichen`;
  };
  updateCounter();
  control.addEventListener('input', () => {
    setIn(doc.root(), path, control.value);
    updateCounter();
    markChanged(doc, el, path);
    doc.onChange();
  });
  const isLink = /^https?:\/\//.test(value) || (typeof key === 'string' && /(^href$|^url$|Url$|Href$)/.test(key));
  if (isLink) {
    const open = h('button.btn.btn-icon', { type: 'button', title: 'Link öffnen' }, '↗');
    open.addEventListener('click', () => {
      const v = control.value.trim();
      const base = S.sites.find((s) => s.id === doc.siteId)?.liveUrl || '';
      if (/^https?:\/\//.test(v)) window.open(v, '_blank', 'noopener,noreferrer');
      else if (v.startsWith('/') && base) window.open(base + v, '_blank', 'noopener,noreferrer');
    });
    return [h('div.input-row', {}, control, open), counter ? h('div.field-foot', {}, counter) : null];
  }
  return [control, counter ? h('div.field-foot', {}, counter) : null];
}

function numberControl(doc, path, value, el) {
  const control = h('input.input.input-num', { type: 'text', inputmode: 'decimal' });
  control.value = String(value).replace('.', ',');
  control.addEventListener('input', () => {
    const raw = control.value.trim().replace(/\s/g, '').replace(',', '.');
    const num = Number(raw);
    const ok = raw !== '' && Number.isFinite(num);
    control.classList.toggle('invalid', !ok);
    if (!ok) return;
    setIn(doc.root(), path, num);
    markChanged(doc, el, path);
    doc.onChange();
  });
  return [control];
}

function boolControl(doc, path, value, el) {
  const box = h('input', { type: 'checkbox' });
  box.checked = value;
  const text = h('span', {}, value ? 'Ja' : 'Nein');
  box.addEventListener('change', () => {
    setIn(doc.root(), path, box.checked);
    text.textContent = box.checked ? 'Ja' : 'Nein';
    markChanged(doc, el, path);
    doc.onChange();
  });
  return [h('label.switch', {}, box, text)];
}

function renderLeaf(doc, key, value, path, parent) {
  const el = fieldShell(key, path, value);
  if (typeof value === 'number') el.append(...numberControl(doc, path, value, el));
  else if (typeof value === 'boolean') el.append(...boolControl(doc, path, value, el));
  else if (isImagePath(value)) el.append(imageStringControl(doc, path, value, el));
  else el.append(...textControl(doc, key, path, value == null ? '' : String(value), el, path[path.length - 2]).filter(Boolean));
  const hint = hintFor(key, parent, value);
  if (hint) el.append(hint);
  markChanged(doc, el, path);
  return el;
}

const renderFields = (doc, obj, path) => Object.keys(obj).filter((k) => !isMeta(k)).map((k) => renderNode(doc, k, obj[k], [...path, k], obj));

function renderNode(doc, key, value, path, parent) {
  if (Array.isArray(value)) return renderArray(doc, key, path, parent);
  if (isImageObj(value)) return renderImageObj(doc, key, path);
  if (isObj(value)) {
    return h('div.group', { 'data-path': pathKey(path) },
      h('div.group-title', {}, h('span', {}, labelFor(key, value))),
      value._help ? h('div.field-hint', {}, value._help) : null,
      renderFields(doc, value, path));
  }
  return renderLeaf(doc, key, value, path, parent);
}

// ---- images

function thumb(siteId, src, onclick) {
  const img = src && src.startsWith('/images/') ? h('img', { src, alt: '', loading: 'lazy' }) : null;
  const btn = h('button.thumb', { type: 'button', title: 'Bild wählen oder hochladen', onclick }, img || h('span.thumb-missing', {}, 'kein Bild'));
  if (img) img.addEventListener('error', () => img.replaceWith(h('span.thumb-missing', {}, 'keine Vorschau')));
  return btn;
}

function imageStringControl(doc, path, value, el) {
  const input = h('input.input', { type: 'text', value, spellcheck: 'false' });
  const pick = async () => {
    const chosen = await openPicker(doc.siteId, input.value);
    if (!chosen) return;
    input.value = chosen.url;
    input.dispatchEvent(new Event('input'));
  };
  let tb = thumb(doc.siteId, value, pick);
  input.addEventListener('input', () => {
    setIn(doc.root(), path, input.value);
    const next = thumb(doc.siteId, input.value, pick);
    tb.replaceWith(next);
    tb = next;
    markChanged(doc, el, path);
    doc.onChange();
  });
  return h('div.image-field', {}, tb, h('div', {}, h('div.input-row', {}, input, h('button.btn', { type: 'button', onclick: pick }, 'Wählen …'))));
}

function renderImageObj(doc, key, path) {
  const obj = getIn(doc.root(), path);
  const el = h('div.group', { 'data-path': pathKey(path) });
  const rebuild = () => el.replaceWith(renderImageObj(doc, key, path));
  const pick = async () => {
    const chosen = await openPicker(doc.siteId, obj.src);
    if (!chosen) return;
    obj.src = chosen.url;
    if (typeof obj.width === 'number' && chosen.width) obj.width = chosen.width;
    if (typeof obj.height === 'number' && chosen.height) obj.height = chosen.height;
    if ('alt' in obj) toast('Neues Bild gesetzt. Bitte den Alternativtext prüfen und anpassen.');
    doc.onChange();
    rebuild();
  };
  const srcPath = [...path, 'src'];
  const srcField = h('div.field', { 'data-path': pathKey(srcPath) }, h('div.field-label', {}, h('span', {}, 'Bilddatei')));
  const srcInput = h('input.input', { type: 'text', value: obj.src, spellcheck: 'false' });
  srcInput.addEventListener('change', () => {
    obj.src = srcInput.value.trim();
    doc.onChange();
    rebuild();
  });
  srcField.append(h('div.input-row', {}, srcInput, h('button.btn', { type: 'button', onclick: pick }, 'Wählen …')));
  markChanged(doc, srcField, srcPath);
  const rest = Object.keys(obj).filter((k) => k !== 'src' && !isMeta(k));
  const dims = rest.filter((k) => ['width', 'height'].includes(k));
  const other = rest.filter((k) => !dims.includes(k));
  el.append(...[
    typeof key === 'number' ? null : h('div.group-title', {}, h('span', {}, labelFor(key, obj))),
    h('div.image-field', {}, thumb(doc.siteId, obj.src, pick),
      h('div', {}, srcField, other.map((k) => renderNode(doc, k, obj[k], [...path, k], obj)),
        dims.length ? h('div.grid-2', {}, dims.map((k) => renderNode(doc, k, obj[k], [...path, k], obj))) : null)),
  ].filter(Boolean));
  return el;
}

// ---- arrays

function emptyLike(value) {
  if (typeof value === 'string') return '';
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.length ? [emptyLike(value[0])] : [];
  if (isObj(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, isMeta(k) ? v : emptyLike(v)]));
  return value;
}

const SUMMARY_KEYS = ['question', 'title', 'name', 'label', 'heading', 'h3', 'term', 'key', 'text', 'value'];
function itemSummary(item) {
  if (typeof item === 'string') return stripHtml(item);
  if (typeof item === 'number') return String(item);
  if (Array.isArray(item)) return item.filter((v) => typeof v !== 'object').map(stripHtml).join(' · ');
  if (isImageObj(item)) return item.alt || item.src;
  if (isObj(item)) {
    if (item._label) return item._label;
    for (const k of SUMMARY_KEYS) if (typeof item[k] === 'string' && item[k].trim()) return stripHtml(item[k]);
    return Object.entries(item).filter(([k, v]) => !isMeta(k) && (typeof v === 'string' || typeof v === 'number')).slice(0, 3).map(([, v]) => stripHtml(v)).join(' · ');
  }
  return '';
}

function renderArray(doc, key, path, parent) {
  const el = h('div.field', { 'data-path': pathKey(path) });
  const draw = () => {
    const arr = getIn(doc.root(), path);
    const objects = arr.some((v) => typeof v === 'object' && v !== null);
    const items = arr.map((item, i) => (objects ? renderArrayCard(doc, path, i, item, draw) : renderArrayRow(doc, path, i, item, draw)));
    const template = arr.length ? arr[0] : null;
    const add = template === null ? null : h('button.btn.btn-small', { type: 'button' }, '+ Eintrag hinzufügen');
    add?.addEventListener('click', () => {
      arr.push(emptyLike(clone(template)));
      doc.openItems.add(pathKey([...path, arr.length - 1]));
      doc.onChange();
      draw();
    });
    const toggleAll = objects && arr.length > 1 ? h('button.btn.btn-small.btn-ghost', { type: 'button' }, 'Alle auf/zu') : null;
    toggleAll?.addEventListener('click', () => {
      const keys = arr.map((_, i) => pathKey([...path, i]));
      const allOpen = keys.every((k) => doc.openItems.has(k));
      keys.forEach((k) => (allOpen ? doc.openItems.delete(k) : doc.openItems.add(k)));
      draw();
    });
    el.replaceChildren(...[
      typeof key === 'number' ? null : h('div.field-label', {}, h('span', {}, `${labelFor(key)} (${arr.length})`)),
      hintFor(key, parent),
      h('div.list', {}, items),
      add || toggleAll ? h('div.list-foot', {}, add, toggleAll) : null,
    ].filter(Boolean));
    markChanged(doc, el, path);
  };
  draw();
  return el;
}

function arrayTools(doc, path, i, draw) {
  const arr = () => getIn(doc.root(), path);
  const move = (delta) => (event) => {
    event.stopPropagation();
    const a = arr();
    const j = i + delta;
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]];
    doc.openItems.clear();
    doc.onChange();
    draw();
  };
  const dup = (event) => {
    event.stopPropagation();
    arr().splice(i + 1, 0, clone(arr()[i]));
    doc.onChange();
    draw();
  };
  const del = (event) => {
    event.stopPropagation();
    arr().splice(i, 1);
    doc.openItems.clear();
    doc.onChange();
    draw();
    toast('Eintrag entfernt. „Verwerfen“ stellt ihn wieder her, solange nicht gespeichert ist.');
  };
  const len = arr().length;
  return h('div.list-tools', {},
    h('button.btn.btn-icon', { type: 'button', title: 'nach oben', disabled: i === 0, onclick: move(-1) }, '↑'),
    h('button.btn.btn-icon', { type: 'button', title: 'nach unten', disabled: i === len - 1, onclick: move(1) }, '↓'),
    h('button.btn.btn-icon', { type: 'button', title: 'duplizieren', onclick: dup }, '⧉'),
    h('button.btn.btn-icon', { type: 'button', title: 'entfernen', onclick: del }, '✕'));
}

function renderArrayRow(doc, path, i, item, draw) {
  const itemPath = [...path, i];
  const leaf = renderLeaf(doc, i, item, itemPath, null);
  leaf.classList.add('flush');
  return h('div.list-row', { 'data-path': pathKey(itemPath) }, leaf, arrayTools(doc, path, i, draw));
}

function renderArrayCard(doc, path, i, item, draw) {
  const itemPath = [...path, i];
  const k = pathKey(itemPath);
  const open = doc.openItems.has(k);
  const summaryText = itemSummary(item);
  const summary = h('span.summary', { class: summaryText ? '' : 'empty' }, summaryText || 'leer');
  const card = h('div.list-item', { class: open ? 'open' : '', 'data-path': k });
  const head = h('div.list-item-head', { role: 'button', tabindex: '0', 'aria-expanded': String(open) },
    h('span.chev', { 'aria-hidden': 'true' }, '▸'), h('span.idx', {}, i + 1), summary, arrayTools(doc, path, i, draw));
  const toggle = () => {
    const isOpen = card.classList.toggle('open');
    head.setAttribute('aria-expanded', String(isOpen));
    doc.openItems[isOpen ? 'add' : 'delete'](k);
  };
  head.addEventListener('click', toggle);
  head.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && e.target === head && (e.preventDefault(), toggle()));
  let body;
  if (Array.isArray(item)) body = renderArray(doc, i, itemPath, null);
  else if (isImageObj(item)) body = renderImageObj(doc, i, itemPath);
  else if (isObj(item)) body = renderFields(doc, item, itemPath);
  else body = renderLeaf(doc, i, item, itemPath, null);
  card.append(head, h('div.list-item-body', {}, body));
  card.addEventListener('input', () => {
    const text = itemSummary(getIn(doc.root(), itemPath));
    summary.textContent = text || 'leer';
    summary.classList.toggle('empty', !text);
    card.classList.toggle('changed', !same(getIn(doc.root(), itemPath), getIn(doc.orig(), itemPath)));
  });
  card.classList.toggle('changed', !same(item, getIn(doc.orig(), itemPath)));
  return card;
}

// ------------------------------------------------------------------ cards

function sectionCard(title, help, children) {
  return h('section.card', {}, h('div.card-head', {}, h('h2', {}, title)), help ? h('p.card-help', {}, help) : null, h('div.card-body', {}, children));
}

function objectAsCards(doc, obj, path, generalTitle = 'Allgemein') {
  const keys = Object.keys(obj).filter((k) => !isMeta(k));
  const leaves = keys.filter((k) => !isObj(obj[k]) || isImageObj(obj[k]));
  const groups = keys.filter((k) => isObj(obj[k]) && !isImageObj(obj[k]));
  const cards = [];
  if (leaves.length) cards.push(sectionCard(generalTitle, null, leaves.map((k) => renderNode(doc, k, obj[k], [...path, k], obj))));
  for (const k of groups) cards.push(sectionCard(labelFor(k, obj[k]), obj[k]._help, renderFields(doc, obj[k], [...path, k])));
  return cards;
}

function pageHead({ crumb, title, chips = [], actions = [] }) {
  return h('div.page-head', {},
    h('div', {}, crumb ? h('div.crumb', {}, crumb) : null, h('h1', {}, title), chips.length ? h('div.chips', {}, chips) : null),
    h('div.page-actions', {}, actions));
}

function focusPending() {
  const target = S.pendingFocus;
  if (!target) return;
  S.pendingFocus = null;
  requestAnimationFrame(() => {
    const el = document.querySelector(`[data-path="${CSS.escape(target.path)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1500);
    const control = el.querySelector('textarea, input');
    if (control) {
      control.focus({ preventScroll: true });
      const idx = control.value.toLowerCase().indexOf(String(target.select || '').toLowerCase());
      if (target.select && idx >= 0 && control.setSelectionRange) control.setSelectionRange(idx, idx + target.select.length);
    }
  });
}

function openAncestors(openItems, path) {
  for (let i = 1; i <= path.length; i += 1) if (typeof path[i - 1] === 'number') openItems.add(pathKey(path.slice(0, i)));
}

// ------------------------------------------------------------------ site view

async function loadSite(id) {
  const st = siteState(id);
  if (st.loaded) return st;
  const res = await api(`/admin/api/sites/${id}/content`);
  Object.assign(st, { loaded: true, data: res.draft, saved: clone(res.draft), rev: res.rev, published: res.published, info: res });
  return st;
}

function views(data) {
  const out = [{ id: 'site', label: (data.site && data.site._label) || 'Website & Live-URL', group: 'Allgemein' }];
  for (const [k, v] of Object.entries(data.shared || {})) if (!isMeta(k)) out.push({ id: `shared/${k}`, label: labelFor(k, v), group: 'Gemeinsame Daten' });
  for (const [k, v] of Object.entries(data.pages || {})) if (!isMeta(k)) out.push({ id: `page/${k}`, label: labelFor(k, v), path: v._path, group: 'Seiten' });
  out.push({ id: 'versions', label: 'Versionen & Veröffentlichen', group: 'Veröffentlichung' });
  return out;
}

const viewForPath = (path) => (path[0] === 'site' ? 'site' : path[0] === 'shared' ? `shared/${path[1]}` : `page/${path[1]}`);

function statusBar(site, st) {
  const pending = !same(st.saved, st.published);
  const publishBtn = h('button.btn.btn-publish', { type: 'button', onclick: () => openPublish(site) }, 'Veröffentlichen');
  if (pending) {
    return h('div.status-bar.pending', {},
      h('span.pill.pill-warn', {}, 'Entwurf'),
      h('span.grow', {}, `Gespeicherte Änderungen sind noch nicht online (zuletzt ${when(st.info.updatedAt)} von ${st.info.updatedBy || '–'}).`),
      h('button.btn', { type: 'button', onclick: () => discardDraft(site) }, 'Entwurf verwerfen'),
      publishBtn);
  }
  return h('div.status-bar', {},
    h('span.pill.pill-ok', {}, `Online: v${st.info.publishedVersion}`),
    h('span.grow', {}, `Veröffentlicht ${when(st.info.publishedAt)} von ${st.info.publishedBy || '–'}. Der Entwurf entspricht dem Online-Stand.`));
}

async function renderSite(site) {
  const app = $('#app');
  let st;
  try {
    st = await loadSite(site.id);
  } catch (error) {
    app.replaceChildren(h('div.empty-state', {}, `Inhalte konnten nicht geladen werden: ${error.message}`));
    return;
  }
  if (S.route.site !== site.id) return;
  const data = st.data;
  const list = views(data);
  const viewId = list.some((v) => v.id === S.route.view) ? S.route.view : list.find((v) => v.group === 'Seiten')?.id || 'site';
  const doc = { siteId: site.id, root: () => st.data, orig: () => st.saved, openItems: st.openItems, onChange: refreshDirtyUi };

  const navList = h('div');
  const search = h('input.side-search', { type: 'search', placeholder: 'Text suchen …', value: st.search, 'aria-label': 'In allen Inhalten suchen' });
  const drawNav = () => {
    const q = search.value.trim();
    st.search = q;
    if (q.length >= 2) return navList.replaceChildren(...searchHits(site, st, q));
    const out = [];
    let group = null;
    for (const v of list) {
      if (v.group !== group) out.push(h('div.side-group', {}, (group = v.group)));
      out.push(h('a.side-link', { href: `#/s/${site.id}/${v.id}`, 'aria-current': v.id === viewId ? 'page' : null }, h('span', {}, v.label), v.path ? h('span.side-path', {}, v.path) : null));
    }
    navList.replaceChildren(...out);
  };
  search.addEventListener('input', drawNav);
  drawNav();
  const sidebar = h('aside.sidebar', {}, h('div.side-site', {}, h('span.side-site-mark'), h('div', {}, h('h2', {}, site.label), h('p', {}, site.note))), search, navList);

  const main = h('main.main', {}, statusBar(site, st));
  const openLive = (p) => [
    h('a.btn', { href: '/admin/preview', target: '_blank', rel: 'noopener' }, 'Entwurf ansehen ↗'),
    ...(site.liveUrl && p ? [h('a.btn', { href: site.liveUrl + p, target: '_blank', rel: 'noopener noreferrer' }, 'Live ansehen ↗')] : []),
  ];

  if (viewId === 'versions') {
    main.append(pageHead({ crumb: site.label, title: 'Versionen & Veröffentlichen' }));
    main.append(await versionsView(site, st));
  } else if (viewId === 'site') {
    const rest = Object.fromEntries(Object.entries(data.site || {}).filter(([k]) => k !== 'liveUrl'));
    main.append(
      pageHead({ crumb: site.label, title: 'Website & Live-URL', actions: openLive('/') }),
      sectionCard('Live-URL', 'Die Domain, unter der diese Website erreichbar ist. Bestimmt Canonical-Links, Sitemap und Open-Graph-Adressen. „Übernehmen“ veröffentlicht die Änderung sofort.', liveBox(site)),
      ...objectAsCards(doc, rest, ['site'], 'Website-Einstellungen'));
  } else if (viewId.startsWith('shared/')) {
    const key = viewId.slice(7);
    const obj = data.shared[key];
    main.append(pageHead({ crumb: `${site.label} · Gemeinsame Daten`, title: labelFor(key, obj), chips: [h('span.chip', {}, 'wirkt auf allen Seiten')] }));
    if (obj?._help) main.append(h('div.notice.info', {}, obj._help));
    main.append(...(isObj(obj) ? objectAsCards(doc, obj, ['shared', key]) : [sectionCard(labelFor(key), null, renderNode(doc, key, obj, ['shared', key], data.shared))]));
  } else {
    const key = viewId.slice(5);
    const page = data.pages[key];
    main.append(pageHead({ crumb: `${site.label} · Seiten`, title: labelFor(key, page), chips: page._path ? [h('span.chip', {}, page._path)] : [], actions: openLive(page._path) }));
    if (page._help) main.append(h('div.notice.info', {}, page._help));
    main.append(...objectAsCards(doc, page, ['pages', key], 'Seite'));
  }

  app.replaceChildren(h('div.layout', {}, sidebar, main));
  refreshDirtyUi();
  focusPending();
}

function highlight(text, q) {
  const plain = stripHtml(text);
  const idx = plain.toLowerCase().indexOf(q.toLowerCase());
  if (idx < 0) return [plain.slice(0, 90)];
  const start = Math.max(0, idx - 30);
  return [start ? '… ' : '', plain.slice(start, idx), h('mark', {}, plain.slice(idx, idx + q.length)), plain.slice(idx + q.length, idx + q.length + 60)];
}

function searchHits(site, st, q) {
  const needle = q.toLowerCase();
  const hits = [];
  for (const [key, value] of flatten(st.data)) {
    if ((typeof value === 'string' || typeof value === 'number') && String(value).toLowerCase().includes(needle)) {
      hits.push({ path: key.split('.').map((p) => (/^\d+$/.test(p) ? Number(p) : p)), value: String(value) });
      if (hits.length >= 60) break;
    }
  }
  if (!hits.length) return [h('div.search-empty', {}, 'Keine Treffer.')];
  const where = (p) => (p[0] === 'pages' ? labelFor(p[1], st.data.pages[p[1]]) : p[0] === 'shared' ? labelFor(p[1], st.data.shared[p[1]]) : 'Website');
  return hits.map((hit) =>
    h('button.search-hit', {
      type: 'button',
      onclick: () => {
        openAncestors(st.openItems, hit.path);
        S.pendingFocus = { path: pathKey(hit.path), select: q };
        go(site.id, viewForPath(hit.path));
      },
    }, h('b', {}, `${where(hit.path)} › ${labelFor(hit.path[hit.path.length - 1])}`), highlight(hit.value, q)));
}

async function versionsView(site, st) {
  let rows = [];
  try {
    rows = await api(`/admin/api/sites/${site.id}/versions`);
  } catch (error) {
    return h('div.notice', {}, error.message);
  }
  const pending = !same(st.saved, st.published);
  return h('div', {},
    linkCheckCard(site, st),
    sectionCard('Veröffentlichen', pending
      ? 'Der gespeicherte Entwurf enthält Änderungen, die noch nicht online sind. Beim Veröffentlichen sind sie sofort live.'
      : 'Der Entwurf entspricht dem Online-Stand. Es gibt nichts zu veröffentlichen.',
    h('div.list-foot', {}, h('button.btn.btn-publish', { type: 'button', disabled: !pending, onclick: () => openPublish(site) }, 'Veröffentlichen'))),
    sectionCard('Versionsverlauf', '„Als Entwurf laden“ holt einen alten Stand zurück in den Entwurf. Online ändert sich erst nach dem nächsten Veröffentlichen.',
      h('div.versions', {}, rows.map((v) =>
        h('div.version', {},
          h('b', {}, `v${v.version}`),
          h('div', {}, h('span', {}, v.note || 'ohne Notiz'), h('small', {}, `${when(v.published_at)} · ${v.published_by || '–'}`)),
          v.version === st.info.publishedVersion
            ? h('span.pill.pill-ok', {}, 'online')
            : h('button.btn.btn-small', { type: 'button', onclick: () => restoreVersion(site, v.version) }, 'Als Entwurf laden'))))));
}

// ------------------------------------------------------------------ link check

/** 'site.footer.shopLinks[0].href' -> ['site', 'footer', 'shopLinks', 0, 'href'] */
const parsePath = (p) => p.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean).map((x) => (/^\d+$/.test(x) ? Number(x) : x));

function linkCheckCard(site, st) {
  const out = h('div.link-results');
  const button = h('button.btn', { type: 'button' }, 'Alle Links prüfen');
  const goTo = (path) => {
    const parts = parsePath(path);
    openAncestors(st.openItems, parts);
    S.pendingFocus = { path: pathKey(parts) };
    go(site.id, viewForPath(parts));
  };
  button.addEventListener('click', async () => {
    if (dirtyCount(site.id) && !(await save())) return;
    button.disabled = true;
    out.replaceChildren(h('p.card-help', {}, 'Prüfe alle Links im gespeicherten Entwurf … (dauert einige Sekunden)'));
    try {
      const rows = await api(`/admin/api/sites/${site.id}/link-check`);
      const bad = rows.filter((r) => !r.ok);
      const hints = rows.filter((r) => r.ok && r.problem);
      out.replaceChildren(
        h('p', {}, bad.length
          ? h('span.pill.pill-bad', {}, `${bad.length === 1 ? '1 toter Link' : `${bad.length} tote Links`} – vor dem Veröffentlichen korrigieren`)
          : h('span.pill.pill-ok', {}, `Alle ${rows.length - hints.length} Links zu selini-shirt.de & eigenen Seiten funktionieren`)),
        ...[...bad, ...hints].map((r) => h('div.link-row', {},
          h('span.pill', { class: r.ok ? 'pill-warn' : 'pill-bad' }, r.status ? String(r.status) : '–'),
          h('div', {},
            h('a.mono', { href: r.url, target: '_blank', rel: 'noopener noreferrer' }, r.url),
            h('small', {}, r.problem || ''),
            h('div', {}, r.usedIn.map((p) => h('button.btn.btn-small.btn-ghost', { type: 'button', onclick: () => goTo(p) }, `Feld öffnen: ${p}`)))))),
      );
    } catch (error) {
      out.replaceChildren(h('div.notice', {}, error.message));
    } finally {
      button.disabled = false;
    }
  });
  return sectionCard('Links prüfen', 'Testet jeden Link des Entwurfs (Shop-Buttons, Fußzeile, Rechtliches …) gegen die echten Seiten. Tote Links zu selini-shirt.de werden rot markiert.',
    h('div', {}, h('div.list-foot', {}, button), out));
}

// ------------------------------------------------------------------ save / publish

async function save() {
  const id = S.route.site;
  const st = S.site[id];
  if (!id || !st?.data || !dirtyCount(id)) return true;
  const button = $('#save');
  button.disabled = true;
  try {
    const res = await api(`/admin/api/sites/${id}/content`, { method: 'PUT', body: { data: st.data, rev: st.rev } });
    st.data = res.draft;
    st.saved = clone(res.draft);
    st.rev = res.rev;
    st.info.updatedAt = Date.now();
    st.info.updatedBy = S.me.email;
    const site = S.sites.find((s) => s.id === id);
    site.hasUnpublished = res.hasUnpublished;
    toast('Entwurf gespeichert. Noch nicht online.', { action: { label: 'Veröffentlichen', fn: () => openPublish(site) }, timeout: 8000 });
    render();
    return true;
  } catch (error) {
    toast(error.message, { kind: 'bad', timeout: 12000, action: error.status === 409 ? { label: 'Neu laden', fn: () => reloadSite(id) } : undefined });
    return false;
  } finally {
    button.disabled = false;
  }
}

function reloadSite(id) {
  const st = S.site[id];
  if (st) {
    st.loaded = false;
    st.openItems.clear();
  }
  render();
}

function discardLocal() {
  const st = S.site[S.route.site];
  if (!st?.data) return;
  st.data = clone(st.saved);
  st.openItems.clear();
  render();
}

async function discardDraft(site) {
  if (dirtyCount(site.id)) discardLocal();
  try {
    await api(`/admin/api/sites/${site.id}/discard`, { method: 'POST', body: {} });
    toast('Entwurf verworfen. Es gilt wieder der Online-Stand.');
    await refreshSites();
    reloadSite(site.id);
  } catch (error) {
    toast(error.message, { kind: 'bad' });
  }
}

async function restoreVersion(site, version) {
  if (dirtyCount(site.id) && !(await save())) return;
  try {
    await api(`/admin/api/sites/${site.id}/versions/${version}/restore`, { method: 'POST', body: {} });
    toast(`Version ${version} als Entwurf geladen. Prüfen und dann veröffentlichen.`, { timeout: 8000 });
    await refreshSites();
    reloadSite(site.id);
  } catch (error) {
    toast(error.message, { kind: 'bad' });
  }
}

let publishSite = null;
async function openPublish(site) {
  if (dirtyCount(site.id) && !(await save())) return;
  publishSite = site;
  const st = S.site[site.id];
  const changes = st ? diffCount(st.published, st.saved) : 0;
  $('#publish-title').textContent = `${site.label} veröffentlichen`;
  $('#publish-help').textContent = `${changes === 1 ? '1 geänderter Wert' : `${changes} geänderte Werte`} gegenüber dem Online-Stand. Die Änderung ist danach sofort online. Vorher prüfen: „Entwurf ansehen“.`;
  $('#publish-note').value = '';
  $('#publish').showModal();
}

$('#publish-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const site = publishSite;
  const button = event.target.querySelector('button');
  button.disabled = true;
  try {
    const res = await api(`/admin/api/sites/${site.id}/publish`, { method: 'POST', body: { note: $('#publish-note').value } });
    $('#publish').close();
    toast(`Version ${res.version} veröffentlicht. ${res.build.message}`, { kind: res.build.state === 'error' ? 'bad' : '', timeout: 12000 });
    await refreshSites();
    reloadSite(site.id);
  } catch (error) {
    toast(error.message, { kind: 'bad' });
  } finally {
    button.disabled = false;
  }
});

$('#save').addEventListener('click', save);
$('#discard').addEventListener('click', discardLocal);
document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    save();
  }
});
window.addEventListener('beforeunload', (event) => {
  if (S.sites.some((s) => dirtyCount(s.id))) event.preventDefault();
});

// ------------------------------------------------------------------ account

$('#btn-logout').addEventListener('click', async () => {
  if (S.sites.some((s) => dirtyCount(s.id)) && !window.confirm('Es gibt ungespeicherte Änderungen. Trotzdem abmelden?')) return;
  await api('/admin/api/logout', { method: 'POST', body: {} }).catch(() => {});
  location.replace('/admin/login');
});
function drawTwoFactor() {
  const on = Boolean(S.me?.twoFactorEnabled);
  $('#tfa-state').textContent = on ? 'eingeschaltet' : 'ausgeschaltet';
  $('#tfa-state').className = `pill ${on ? 'pill-ok' : 'pill-muted'}`;
  $('#tfa-help').textContent = on
    ? 'Bei jeder Anmeldung wird zusätzlich ein Code aus Ihrer Authenticator-App abgefragt.'
    : 'Optional, aber empfohlen: Bei der Anmeldung wird zusätzlich zum Passwort ein Code aus einer Authenticator-App abgefragt.';
  $('#tfa-action').textContent = on ? 'Ausschalten' : 'Einrichten';
  $('#tfa-action').className = on ? 'btn btn-danger' : 'btn btn-primary';
  $('#tfa-password-form').hidden = false;
  $('#tfa-password-form').reset();
  $('#tfa-enroll').hidden = true;
}

$('#btn-account').addEventListener('click', () => {
  $('#password-form').reset();
  drawTwoFactor();
  $('#account').showModal();
});

$('#tfa-password-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const password = $('#tfa-password').value;
  try {
    if (S.me.twoFactorEnabled) {
      await api('/admin/api/me/2fa/disable', { method: 'POST', body: { password } });
      S.me.twoFactorEnabled = false;
      drawTwoFactor();
      toast('Zwei-Faktor-Anmeldung ausgeschaltet.');
      return;
    }
    const { qr, secret, backupCodes } = await api('/admin/api/me/2fa/start', { method: 'POST', body: { password } });
    $('#tfa-qr').src = qr;
    $('#tfa-secret').textContent = secret.replace(/(.{4})/g, '$1 ').trim();
    $('#tfa-codes').textContent = backupCodes.join('\n');
    $('#tfa-password-form').hidden = true;
    $('#tfa-enroll').hidden = false;
    $('#tfa-confirm-form').reset();
    $('#tfa-code').focus();
  } catch (error) {
    toast(error.message, { kind: 'bad' });
  }
});

$('#tfa-confirm-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('/admin/api/me/2fa/confirm', { method: 'POST', body: { code: $('#tfa-code').value } });
    S.me.twoFactorEnabled = true;
    drawTwoFactor();
    toast('Zwei-Faktor-Anmeldung eingeschaltet. Ab der nächsten Anmeldung wird der Code abgefragt.', { timeout: 8000 });
  } catch (error) {
    toast(error.message, { kind: 'bad' });
  }
});

$('#password-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('/admin/api/me/password', { method: 'POST', body: { current: $('#pw-current').value, next: $('#pw-next').value } });
    $('#account').close();
    toast('Passwort geändert. Andere Sitzungen wurden abgemeldet.');
  } catch (error) {
    toast(error.message, { kind: 'bad' });
  }
});

// ------------------------------------------------------------------ image picker

const picker = { resolve: null, siteId: null, current: null, images: {} };

async function openPicker(siteId, current) {
  picker.siteId = siteId;
  picker.current = current;
  $('#picker-note').textContent = 'JPG, PNG, WebP oder AVIF bis 4 MB. Wird in WebP (max. 1920 px breit) umgewandelt; Metadaten wie GPS werden entfernt.';
  $('#picker-filter').value = '';
  await drawPicker(true);
  $('#picker').showModal();
  return new Promise((resolve) => {
    picker.resolve = resolve;
  });
}

async function drawPicker(reload = false) {
  const grid = $('#picker-grid');
  if (reload || !picker.images[picker.siteId]) {
    grid.replaceChildren(h('div.search-empty', {}, 'lade Bilder …'));
    try {
      picker.images[picker.siteId] = await api(`/admin/api/sites/${picker.siteId}/media`);
    } catch (error) {
      grid.replaceChildren(h('div.search-empty', {}, error.message));
      return;
    }
  }
  const q = $('#picker-filter').value.trim().toLowerCase();
  const list = picker.images[picker.siteId].filter((img) => !q || img.path.toLowerCase().includes(q));
  grid.replaceChildren(...list.map((img) =>
    h('button.pick', { type: 'button', class: img.path === picker.current ? 'current' : '', title: img.path, onclick: () => choosePicked({ url: img.path, width: img.width, height: img.height }) },
      h('span.thumb', {}, h('img', { src: img.path, alt: '', loading: 'lazy' })),
      h('span', {}, img.path.split('/').pop()))));
  if (!list.length) grid.append(h('div.search-empty', {}, 'Keine Bilder gefunden. Laden Sie oben ein Bild hoch.'));
}

function choosePicked(result) {
  const resolve = picker.resolve;
  picker.resolve = null;
  $('#picker').close();
  resolve?.(result);
}
$('#picker').addEventListener('close', () => {
  if (picker.resolve) choosePicked(null);
});
$('#picker-filter').addEventListener('input', () => drawPicker(false));

async function uploadFile(file) {
  if (!file) return;
  const note = $('#picker-note');
  const before = note.textContent;
  note.textContent = `Lade „${file.name}“ hoch …`;
  try {
    const result = await api(`/admin/api/sites/${picker.siteId}/upload?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file, headers: { 'content-type': 'application/octet-stream' } });
    picker.images[picker.siteId] = null;
    toast(`Hochgeladen: ${result.url}`);
    choosePicked(result);
  } catch (error) {
    note.textContent = before;
    toast(error.message, { kind: 'bad' });
  }
}
$('#picker-upload').addEventListener('change', (event) => {
  uploadFile(event.target.files[0]);
  event.target.value = '';
});
const drop = $('#picker-drop');
drop.addEventListener('dragover', (event) => {
  event.preventDefault();
  drop.classList.add('dragging');
});
drop.addEventListener('dragleave', () => drop.classList.remove('dragging'));
drop.addEventListener('drop', (event) => {
  event.preventDefault();
  drop.classList.remove('dragging');
  uploadFile(event.dataTransfer.files[0]);
});

boot();
