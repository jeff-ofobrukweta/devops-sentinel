export const METRIC_KINDS = ['cpu', 'memory', 'disk'] as const;
export type MetricKind = (typeof METRIC_KINDS)[number];

export const HEALTH_STATES = ['healthy', 'warning', 'critical', 'unknown'] as const;
export type HealthState = (typeof HEALTH_STATES)[number];

export const OUTPUT_FORMATS = ['text', 'json'] as const;
export type OutputFormat = (typeof OUTPUT_FORMATS)[number];

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface Thresholds {
  warning: number;
  critical: number;
}

export type MetricDetails = Record<string, string | number | boolean>;

export interface MetricReading {
  kind: MetricKind;
  name: string;
  value: number;
  details: MetricDetails;
}

export interface MetricResult {
  kind: MetricKind;
  name: string;
  status: HealthState;
  value: number | null;
  unit: '%';
  thresholds: Thresholds;
  details: MetricDetails;
  error?: string;
}

export interface HostInfo {
  hostname: string;
  platform: string;
  arch: string;
  containerized: boolean;
}

export interface HealthReport {
  schemaVersion: 1;
  timestamp: string;
  host: HostInfo;
  overall: HealthState;
  metrics: MetricResult[];
}

export interface SentinelConfig {
  once: boolean;
  intervalSeconds: number;
  cpuSampleMs: number;
  collectorTimeoutMs: number;
  format: OutputFormat;
  color: boolean | 'auto';
  logLevel: LogLevel;
  diskPaths: string[];
  thresholds: Record<MetricKind, Thresholds>;
}
