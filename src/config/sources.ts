import { type ParseArgsConfig, parseArgs } from 'node:util';
import { METRIC_KINDS, type MetricKind, type Thresholds } from '../types.js';
import { ConfigError, type ConfigInput, setThreshold } from './input.js';

type NumericKey = 'intervalSeconds' | 'cpuSampleMs' | 'collectorTimeoutMs';
const NUMERIC_KEYS: readonly NumericKey[] = ['intervalSeconds', 'cpuSampleMs', 'collectorTimeoutMs'];
const LEVELS: readonly (keyof Thresholds)[] = ['warning', 'critical'];

const THRESHOLD_FIELDS = METRIC_KINDS.flatMap((kind) => LEVELS.map((level) => ({ kind, level })));

function parseNumber(raw: string, label: string, issues: string[]): number | undefined {
  const value = raw.trim() === '' ? Number.NaN : Number(raw);
  if (Number.isFinite(value)) return value;
  issues.push(`${label} must be a number (got "${raw}")`);
  return undefined;
}

function parseBoolean(raw: string, label: string, issues: string[]): boolean | undefined {
  const normalised = raw.trim().toLowerCase();
  if (['true', '1', 'yes'].includes(normalised)) return true;
  if (['false', '0', 'no'].includes(normalised)) return false;
  issues.push(`${label} must be true or false (got "${raw}")`);
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------- file

function readFileThresholds(raw: unknown, input: ConfigInput, issues: string[]): void {
  if (!isRecord(raw)) {
    issues.push('thresholds must be an object');
    return;
  }
  for (const [kind, levels] of Object.entries(raw)) {
    if (!(METRIC_KINDS as readonly string[]).includes(kind)) {
      issues.push(`thresholds.${kind} is not a known metric (expected ${METRIC_KINDS.join(', ')})`);
      continue;
    }
    if (!isRecord(levels)) {
      issues.push(`thresholds.${kind} must be an object`);
      continue;
    }
    for (const [level, value] of Object.entries(levels)) {
      if (!(LEVELS as readonly string[]).includes(level)) issues.push(`thresholds.${kind}.${level} is not a known level`);
      else if (typeof value !== 'number') issues.push(`thresholds.${kind}.${level} must be a number`);
      else setThreshold(input, kind as MetricKind, level as keyof Thresholds, value);
    }
  }
}

export function configFromFile(text: string, origin: string): ConfigInput {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new ConfigError([`${origin}: invalid JSON (${(error as Error).message})`]);
  }
  if (!isRecord(raw)) throw new ConfigError([`${origin}: top level must be a JSON object`]);

  const input: ConfigInput = {};
  const issues: string[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if ((NUMERIC_KEYS as readonly string[]).includes(key)) {
      if (typeof value === 'number') input[key as NumericKey] = value;
      else issues.push(`${key} must be a number`);
    } else if (key === 'once') {
      if (typeof value === 'boolean') input.once = value;
      else issues.push('once must be a boolean');
    } else if (key === 'format' || key === 'logLevel') {
      if (typeof value === 'string') input[key] = value;
      else issues.push(`${key} must be a string`);
    } else if (key === 'color') {
      if (typeof value === 'boolean' || value === 'auto') input.color = value;
      else issues.push('color must be true, false or "auto"');
    } else if (key === 'diskPaths') {
      if (Array.isArray(value) && value.every((item) => typeof item === 'string')) input.diskPaths = value;
      else issues.push('diskPaths must be an array of strings');
    } else if (key === 'thresholds') {
      readFileThresholds(value, input, issues);
    } else {
      issues.push(`unknown setting "${key}"`);
    }
  }
  if (issues.length > 0) throw new ConfigError(issues.map((issue) => `${origin}: ${issue}`));
  return input;
}

// ---------------------------------------------------------------- environment

const ENV_NUMBERS: Record<string, NumericKey> = {
  SENTINEL_INTERVAL_SECONDS: 'intervalSeconds',
  SENTINEL_CPU_SAMPLE_MS: 'cpuSampleMs',
  SENTINEL_COLLECTOR_TIMEOUT_MS: 'collectorTimeoutMs',
};

const envThresholdName = (kind: MetricKind, level: keyof Thresholds) =>
  `SENTINEL_${kind.toUpperCase()}_${level.toUpperCase()}`;

export function configFromEnv(env: Record<string, string | undefined>): ConfigInput {
  const input: ConfigInput = {};
  const issues: string[] = [];
  const read = (name: string) => (env[name] === undefined || env[name] === '' ? undefined : env[name]);

  for (const [name, key] of Object.entries(ENV_NUMBERS)) {
    const raw = read(name);
    const value = raw === undefined ? undefined : parseNumber(raw, name, issues);
    if (value !== undefined) input[key] = value;
  }
  for (const { kind, level } of THRESHOLD_FIELDS) {
    const name = envThresholdName(kind, level);
    const raw = read(name);
    const value = raw === undefined ? undefined : parseNumber(raw, name, issues);
    if (value !== undefined) setThreshold(input, kind, level, value);
  }

  const once = read('SENTINEL_ONCE');
  if (once !== undefined) {
    const value = parseBoolean(once, 'SENTINEL_ONCE', issues);
    if (value !== undefined) input.once = value;
  }
  const format = read('SENTINEL_FORMAT');
  if (format !== undefined) input.format = format;
  const logLevel = read('SENTINEL_LOG_LEVEL');
  if (logLevel !== undefined) input.logLevel = logLevel;
  const diskPaths = read('SENTINEL_DISK_PATHS');
  if (diskPaths !== undefined) input.diskPaths = diskPaths.split(',').map((path) => path.trim()).filter(Boolean);
  // https://no-color.org: any non-empty value disables colour.
  if (read('NO_COLOR') !== undefined) input.color = false;

  if (issues.length > 0) throw new ConfigError(issues);
  return input;
}

// ---------------------------------------------------------------- CLI flags

const FLAG_NUMBERS: Record<string, NumericKey> = {
  interval: 'intervalSeconds',
  'sample-ms': 'cpuSampleMs',
  'timeout-ms': 'collectorTimeoutMs',
};

const flagThresholdName = (kind: MetricKind, level: keyof Thresholds) => `${kind}-${level}`;

const FLAG_OPTIONS = {
  once: { type: 'boolean' },
  format: { type: 'string', short: 'f' },
  config: { type: 'string', short: 'c' },
  'disk-path': { type: 'string', multiple: true },
  'log-level': { type: 'string' },
  color: { type: 'boolean' },
  'print-config': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
  ...Object.fromEntries(Object.keys(FLAG_NUMBERS).map((flag) => [flag, { type: 'string' }])),
  ...Object.fromEntries(THRESHOLD_FIELDS.map(({ kind, level }) => [flagThresholdName(kind, level), { type: 'string' }])),
} as const satisfies ParseArgsConfig['options'];

export interface ParsedArgs {
  input: ConfigInput;
  configPath?: string;
  help: boolean;
  version: boolean;
  printConfig: boolean;
}

export function configFromArgs(argv: string[]): ParsedArgs {
  let values: Record<string, string | boolean | string[] | undefined>;
  try {
    ({ values } = parseArgs({ args: argv, options: FLAG_OPTIONS, strict: true, allowPositionals: false, allowNegative: true }));
  } catch (error) {
    throw new ConfigError([(error as Error).message]);
  }

  const input: ConfigInput = {};
  const issues: string[] = [];
  const text = (flag: string) => (typeof values[flag] === 'string' ? (values[flag] as string) : undefined);

  for (const [flag, key] of Object.entries(FLAG_NUMBERS)) {
    const raw = text(flag);
    const value = raw === undefined ? undefined : parseNumber(raw, `--${flag}`, issues);
    if (value !== undefined) input[key] = value;
  }
  for (const { kind, level } of THRESHOLD_FIELDS) {
    const flag = flagThresholdName(kind, level);
    const raw = text(flag);
    const value = raw === undefined ? undefined : parseNumber(raw, `--${flag}`, issues);
    if (value !== undefined) setThreshold(input, kind, level, value);
  }
  if (issues.length > 0) throw new ConfigError(issues);

  if (values.once === true) input.once = true;
  if (typeof values.color === 'boolean') input.color = values.color;
  const format = text('format');
  if (format !== undefined) input.format = format;
  const logLevel = text('log-level');
  if (logLevel !== undefined) input.logLevel = logLevel;
  const diskPaths = values['disk-path'];
  if (Array.isArray(diskPaths)) input.diskPaths = diskPaths;

  const configPath = text('config');
  return {
    input,
    ...(configPath === undefined ? {} : { configPath }),
    help: values.help === true,
    version: values.version === true,
    printConfig: values['print-config'] === true,
  };
}
