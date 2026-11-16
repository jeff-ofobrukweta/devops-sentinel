import type { MetricKind, MetricReading } from '../types.js';

export interface Collector {
  kind: MetricKind;
  name: string;
  collect(signal: AbortSignal): Promise<MetricReading>;
}

/** Rounds to two decimal places and clamps to the 0–100 range. */
export function toPercent(ratio: number): number {
  const percent = Math.round(ratio * 10_000) / 100;
  return Math.min(100, Math.max(0, percent));
}
