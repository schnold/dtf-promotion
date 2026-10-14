import { getStore } from '@netlify/blobs';

export interface PriceFormat {
  key: string;
  widthCm: number;
  heightCm: number;
  unitPrice: number;
}

export interface SiteSettings {
  basePricePerMeter: number;
  rollWidthCm: number;
  maxQuantity: number;
  priceUpdatedLabel: string;
  experienceYears: number;
  deliveryLabel: string;
  recommendedDpi: number;
  locationLabel: string;
  formats: PriceFormat[];
}

export const DEFAULT_SETTINGS: SiteSettings = {
  basePricePerMeter: 13.95,
  rollWidthCm: 56,
  maxQuantity: 100,
  priceUpdatedLabel: 'Oktober 2026',
  experienceYears: 30,
  deliveryLabel: '3–5 Tage',
  recommendedDpi: 300,
  locationLabel: 'Berlin',
  formats: [
    { key: 'A6', widthCm: 10.5, heightCm: 14.8, unitPrice: 0.39 },
    { key: 'A5', widthCm: 14.8, heightCm: 21, unitPrice: 0.77 },
    { key: 'A4', widthCm: 21, heightCm: 29.7, unitPrice: 1.55 },
    { key: 'A3', widthCm: 29.7, heightCm: 42, unitPrice: 3.11 },
    { key: 'A2', widthCm: 42, heightCm: 59.4, unitPrice: 6.22 },
    { key: '1 M', widthCm: 56, heightCm: 100, unitPrice: 13.95 },
  ],
};

const SETTINGS_KEY = 'site-settings-v1';

export class SettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettingsValidationError';
  }
}

function getSettingsStore() {
  const deployContext = (process.env.CONTEXT || 'local').toLowerCase().replace(/[^a-z0-9-]/g, '-');
  return getStore({ name: `dtf-transferprint-${deployContext}`, consistency: 'strong' });
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function validateSettings(value: unknown): SiteSettings {
  if (!value || typeof value !== 'object') throw new SettingsValidationError('Ungültige Einstellungen.');
  const input = value as Partial<SiteSettings>;

  const requiredNumbers: Array<[keyof SiteSettings, number, number]> = [
    ['basePricePerMeter', 0, 1_000_000],
    ['rollWidthCm', 1, 1_000],
    ['maxQuantity', 1, 10_000],
    ['experienceYears', 0, 500],
    ['recommendedDpi', 1, 10_000],
  ];

  for (const [key, minimum, maximum] of requiredNumbers) {
    const field = input[key];
    if (!isFiniteNumber(field) || field < minimum || field > maximum) {
      throw new SettingsValidationError(`Ungültiger Zahlenwert: ${String(key)}`);
    }
  }

  const requiredText: Array<keyof SiteSettings> = ['priceUpdatedLabel', 'deliveryLabel', 'locationLabel'];
  for (const key of requiredText) {
    const field = input[key];
    if (typeof field !== 'string' || field.trim().length < 1 || field.length > 80) {
      throw new SettingsValidationError(`Ungültiger Textwert: ${String(key)}`);
    }
  }

  if (!Array.isArray(input.formats) || input.formats.length < 1 || input.formats.length > 20) {
    throw new SettingsValidationError('Es müssen zwischen 1 und 20 Formate vorhanden sein.');
  }

  const formats = input.formats.map((format, index) => {
    if (!format || typeof format !== 'object') throw new SettingsValidationError(`Format ${index + 1} ist ungültig.`);
    const candidate = format as Partial<PriceFormat>;
    if (typeof candidate.key !== 'string' || candidate.key.trim().length < 1 || candidate.key.length > 20) {
      throw new SettingsValidationError(`Formatname ${index + 1} ist ungültig.`);
    }
    for (const [name, number] of [['widthCm', candidate.widthCm], ['heightCm', candidate.heightCm], ['unitPrice', candidate.unitPrice]] as const) {
      if (!isFiniteNumber(number) || number <= 0 || number > 1_000_000) {
        throw new SettingsValidationError(`${name} für Format ${candidate.key} ist ungültig.`);
      }
    }
    return {
      key: candidate.key.trim(),
      widthCm: candidate.widthCm as number,
      heightCm: candidate.heightCm as number,
      unitPrice: candidate.unitPrice as number,
    };
  });

  return {
    basePricePerMeter: input.basePricePerMeter as number,
    rollWidthCm: input.rollWidthCm as number,
    maxQuantity: Math.round(input.maxQuantity as number),
    priceUpdatedLabel: (input.priceUpdatedLabel as string).trim(),
    experienceYears: Math.round(input.experienceYears as number),
    deliveryLabel: (input.deliveryLabel as string).trim(),
    recommendedDpi: Math.round(input.recommendedDpi as number),
    locationLabel: (input.locationLabel as string).trim(),
    formats,
  };
}

export async function getSiteSettings(): Promise<SiteSettings> {
  try {
    const store = getSettingsStore();
    const stored = await store.get(SETTINGS_KEY, { type: 'json', consistency: 'strong' });
    if (stored === null) {
      await store.setJSON(SETTINGS_KEY, DEFAULT_SETTINGS, { onlyIfNew: true });
      return DEFAULT_SETTINGS;
    }
    return validateSettings(stored);
  } catch (error) {
    console.error('Settings could not be read; using safe defaults.', error);
    return DEFAULT_SETTINGS;
  }
}

export async function isSettingsStoreHealthy(): Promise<boolean> {
  try {
    const store = getSettingsStore();
    const stored = await store.get(SETTINGS_KEY, { type: 'json', consistency: 'strong' });
    if (stored === null) await store.setJSON(SETTINGS_KEY, DEFAULT_SETTINGS, { onlyIfNew: true });
    return true;
  } catch (error) {
    console.error('Settings store health check failed.', error);
    return false;
  }
}

export async function saveSiteSettings(settings: SiteSettings): Promise<void> {
  const validated = validateSettings(settings);
  await getSettingsStore().setJSON(SETTINGS_KEY, validated, {
    metadata: { updatedAt: new Date().toISOString() },
  });
}

export function settingsFromForm(form: FormData): SiteSettings {
  const text = (name: string) => String(form.get(name) ?? '').trim();
  const number = (name: string) => Number(text(name).replace(',', '.'));
  const formatCount = Math.round(number('formatCount'));
  const formats: PriceFormat[] = [];

  if (!Number.isFinite(formatCount) || formatCount < 1 || formatCount > 20) {
    throw new SettingsValidationError('Ungültige Anzahl an Formaten.');
  }

  for (let index = 0; index < formatCount; index += 1) {
    formats.push({
      key: text(`format_key_${index}`),
      widthCm: number(`format_width_${index}`),
      heightCm: number(`format_height_${index}`),
      unitPrice: number(`format_price_${index}`),
    });
  }

  return validateSettings({
    basePricePerMeter: number('basePricePerMeter'),
    rollWidthCm: number('rollWidthCm'),
    maxQuantity: number('maxQuantity'),
    priceUpdatedLabel: text('priceUpdatedLabel'),
    experienceYears: number('experienceYears'),
    deliveryLabel: text('deliveryLabel'),
    recommendedDpi: number('recommendedDpi'),
    locationLabel: text('locationLabel'),
    formats,
  });
}
