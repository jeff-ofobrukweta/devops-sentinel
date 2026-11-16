import {
  LOG_LEVELS,
  type LogLevel,
  METRIC_KINDS,
  OUTPUT_FORMATS,
  type OutputFormat,
  type SentinelConfig,
  type Thresholds,
} from '../types.js';
import { DEFAULT_CONFIG } from './defaults.js';
import { ConfigError, type ConfigInput, mergeInputs } from './input.js';

const oneOf = <T extends string>(allowed: readonly T[], value: string): value is T =>
  (allowed as readonly string[]).includes(value);

/** Applies defaults underneath `input`, checks every rule, and reports all problems at once. */
export function validateConfig(input: ConfigInput): SentinelConfig {
  const merged = mergeInputs(DEFAULT_CONFIG, input);
  const issues: string[] = [];
  const config = { ...DEFAULT_CONFIG, ...merged } as SentinelConfig;

  if (config.intervalSeconds < 1 || config.intervalSeconds > 86_400) {
    issues.push(`intervalSeconds must be between 1 and 86400 (got ${config.intervalSeconds})`);
  }
  if (!Number.isInteger(config.cpuSampleMs) || config.cpuSampleMs < 100 || config.cpuSampleMs > 60_000) {
    issues.push(`cpuSampleMs must be a whole number between 100 and 60000 (got ${config.cpuSampleMs})`);
  }
  if (config.collectorTimeoutMs <= config.cpuSampleMs || config.collectorTimeoutMs > 120_000) {
    issues.push(
      `collectorTimeoutMs must be greater than cpuSampleMs (${config.cpuSampleMs}) and at most 120000 (got ${config.collectorTimeoutMs})`,
    );
  }
  if (!oneOf<OutputFormat>(OUTPUT_FORMATS, config.format)) {
    issues.push(`format must be one of ${OUTPUT_FORMATS.join(', ')} (got "${config.format}")`);
  }
  if (!oneOf<LogLevel>(LOG_LEVELS, config.logLevel)) {
    issues.push(`logLevel must be one of ${LOG_LEVELS.join(', ')} (got "${config.logLevel}")`);
  }
  if (config.diskPaths.length === 0 || config.diskPaths.some((path) => path.trim() === '')) {
    issues.push('diskPaths must contain at least one non-empty path');
  }

  const thresholds = {} as Record<(typeof METRIC_KINDS)[number], Thresholds>;
  for (const kind of METRIC_KINDS) {
    const { warning, critical } = { ...DEFAULT_CONFIG.thresholds[kind], ...merged.thresholds?.[kind] };
    thresholds[kind] = { warning, critical };
    if (warning < 0 || critical > 100 || warning >= critical) {
      issues.push(
        `${kind} thresholds must satisfy 0 <= warning < critical <= 100 (got warning ${warning}, critical ${critical})`,
      );
    }
  }

  if (issues.length > 0) throw new ConfigError(issues);
  return { ...config, diskPaths: [...new Set(config.diskPaths)], thresholds };
}
