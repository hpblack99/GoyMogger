import type { CarrierRate } from "./types.ts";

export function sortRates(rates: CarrierRate[]): CarrierRate[] {
  return [...rates].sort((a, b) => a.totalCharge - b.totalCharge);
}

export function filterRates(
  rates: CarrierRate[],
  options?: {
    maxTransitDays?: number;
    maxCharge?: number;
    minCharge?: number;
    serviceTypes?: string[];
  },
): CarrierRate[] {
  if (!options) return rates;
  return rates.filter((rate) => {
    if (options.maxTransitDays && rate.transitDays > options.maxTransitDays) return false;
    if (options.maxCharge && rate.totalCharge > options.maxCharge) return false;
    if (options.minCharge && rate.totalCharge < options.minCharge) return false;
    if (options.serviceTypes?.length && !options.serviceTypes.includes(rate.serviceLevel)) return false;
    return true;
  });
}

export function summarizeRates(rates: CarrierRate[]) {
  if (!rates.length) return null;
  const sorted = sortRates(rates);
  return {
    lowest: sorted[0],
    highest: sorted[sorted.length - 1],
    average: Math.round((rates.reduce((sum, r) => sum + r.totalCharge, 0) / rates.length) * 100) / 100,
    count: rates.length,
  };
}
