import type { SentinelConfig } from '../types.js';

export const DEFAULT_CONFIG: SentinelConfig = {
  once: false,
  intervalSeconds: 10,
  cpuSampleMs: 1000,
  collectorTimeoutMs: 5000,
  format: 'text',
  color: 'auto',
  logLevel: 'info',
  diskPaths: ['/'],
  thresholds: {
    cpu: { warning: 75, critical: 90 },
    memory: { warning: 80, critical: 90 },
    disk: { warning: 80, critical: 90 },
  },
};
