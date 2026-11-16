import { METRIC_KINDS, type MetricKind, type Thresholds } from '../types.js';

/**
 * A partial, not-yet-validated configuration produced by one source
 * (defaults, file, environment or CLI flags). Enum values are plain strings
 * here and are narrowed during validation.
 */
export interface ConfigInput {
  once?: boolean;
  intervalSeconds?: number;
  cpuSampleMs?: number;
  collectorTimeoutMs?: number;
  format?: string;
  color?: boolean | 'auto';
  logLevel?: string;
  diskPaths?: string[];
  thresholds?: Partial<Record<MetricKind, Partial<Thresholds>>>;
}

export class ConfigError extends Error {
  override name = 'ConfigError';

  constructor(readonly issues: string[]) {
    super(`Invalid configuration:\n${issues.map((issue) => `  - ${issue}`).join('\n')}`);
  }
}

/** Later layers win. Thresholds merge per metric and per level. */
export function mergeInputs(...layers: ConfigInput[]): ConfigInput {
  const merged: ConfigInput = {};
  for (const { thresholds, ...scalars } of layers) {
    Object.assign(merged, scalars);
    if (!thresholds) continue;
    merged.thresholds ??= {};
    for (const kind of METRIC_KINDS) {
      const levels = thresholds[kind];
      if (levels) merged.thresholds[kind] = { ...merged.thresholds[kind], ...levels };
    }
  }
  return merged;
}

export function setThreshold(input: ConfigInput, kind: MetricKind, level: keyof Thresholds, value: number): void {
  input.thresholds ??= {};
  input.thresholds[kind] = { ...input.thresholds[kind], [level]: value };
}
