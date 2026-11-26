import { type Cms, REFERENCE } from './cms';

export interface PriceFormat {
  key: string;
  widthCm: number;
  heightCm: number;
  unitPrice: number;
}

/** One row of the shop's Staffelpreis list: from `quantity` metres the price per metre drops to `pricePerMeter`. */
export interface PriceTier {
  quantity: number;
  pricePerMeter: number;
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
  tiers: PriceTier[];
}

export const MAX_FORMATS = 20;
export const MAX_TIERS = 20;

export class SettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettingsValidationError';
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateTiers(value: unknown): PriceTier[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_TIERS) {
    throw new SettingsValidationError(`Es müssen zwischen 1 und ${MAX_TIERS} Staffelpreise vorhanden sein.`);
  }

  const tiers = value.map((tier, index) => {
    if (!tier || typeof tier !== 'object') throw new SettingsValidationError(`Staffel ${index + 1} ist ungültig.`);
    const candidate = tier as Partial<PriceTier>;
    if (!isFiniteNumber(candidate.quantity) || candidate.quantity < 1 || candidate.quantity > 1_000_000 || !Number.isInteger(candidate.quantity)) {
      throw new SettingsValidationError(`Menge für Staffel ${index + 1} ist ungültig (ganze Zahl ab 1).`);
    }
    if (!isFiniteNumber(candidate.pricePerMeter) || candidate.pricePerMeter <= 0 || candidate.pricePerMeter > 1_000_000) {
      throw new SettingsValidationError(`Meterpreis für Staffel ab ${candidate.quantity} ist ungültig.`);
    }
    return { quantity: candidate.quantity, pricePerMeter: candidate.pricePerMeter };
  });

  for (let index = 1; index < tiers.length; index += 1) {
    if (tiers[index].quantity <= tiers[index - 1].quantity) {
      throw new SettingsValidationError('Staffelmengen müssen aufsteigend und eindeutig sein.');
    }
    if (tiers[index].pricePerMeter > tiers[index - 1].pricePerMeter) {
      throw new SettingsValidationError(`Der Meterpreis ab ${tiers[index].quantity} darf nicht über dem der vorherigen Staffel liegen.`);
    }
  }

  return tiers;
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

  if (!Array.isArray(input.formats) || input.formats.length < 1 || input.formats.length > MAX_FORMATS) {
    throw new SettingsValidationError(`Es müssen zwischen 1 und ${MAX_FORMATS} Formate vorhanden sein.`);
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

  const tiers = validateTiers(input.tiers);

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
    tiers,
  };
}

/**
 * Prices and numbers of a cms.json document (`shared.pricing`), edited in the admin (/admin).
 * They mirror the shop product "DTF Transfer Meterware 560 × 1000 mm"
 * (https://selini-shirt.de/product/dtf-transfer-meterware-bestellen, Stand November 2026).
 * Format prices = area × (8.24 € / 0.56 m²), rounded to 2 decimals.
 * validateSettings() both checks the values and drops the `_label`/`_help`/`_hints` metadata keys.
 * The admin runs the same check before saving or publishing, so invalid prices never go live.
 */
export function settingsFrom(cms: Cms): SiteSettings {
  return validateSettings(cms.shared.pricing);
}

/** Prices of the bundled cms.json; checked at build time so a broken file fails the deploy. */
export const DEFAULT_SETTINGS: SiteSettings = settingsFrom(REFERENCE);
