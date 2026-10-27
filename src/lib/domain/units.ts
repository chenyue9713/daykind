// Display units (PRD FR01, FR09). Records are stored in meters and kilograms;
// the profile's units only change what is shown and how typed values are read.
import type { DistanceUnit, WeightUnit } from "./types";

export const METERS_PER_MILE = 1609.344;
export const KG_PER_POUND = 0.45359237;

export function metersFromDistance(value: number, unit: DistanceUnit): number {
  return Math.round(value * (unit === "mi" ? METERS_PER_MILE : 1000) * 100) / 100;
}

export function distanceFromMeters(meters: number, unit: DistanceUnit): number {
  return meters / (unit === "mi" ? METERS_PER_MILE : 1000);
}

export function formatDistance(meters: number | null, unit: DistanceUnit): string {
  if (meters === null) return "Not recorded";
  return `${distanceFromMeters(meters, unit).toFixed(2)} ${unit}`;
}

export function kgFromWeight(value: number, unit: WeightUnit): number {
  return unit === "kg" ? value : value * KG_PER_POUND;
}

export function weightFromKg(kg: number, unit: WeightUnit): number {
  return unit === "kg" ? kg : kg / KG_PER_POUND;
}

export function formatWeight(kg: number, unit: WeightUnit): string {
  return `${weightFromKg(kg, unit).toFixed(1)} ${unit}`;
}

export const distanceUnitLabel: Record<DistanceUnit, string> = { km: "Kilometers", mi: "Miles" };
export const weightUnitLabel: Record<WeightUnit, string> = { kg: "Kilograms", lb: "Pounds" };
