import type { SystemProbe } from '../platform/probe.js';
import type { SentinelConfig } from '../types.js';
import type { Sleep } from '../util/async.js';
import { createCpuCollector } from './cpu.js';
import { createDiskCollector } from './disk.js';
import { createMemoryCollector } from './memory.js';
import type { Collector } from './types.js';

export function buildCollectors(config: SentinelConfig, probe: SystemProbe, sleep: Sleep): Collector[] {
  return [
    createCpuCollector(probe, config.cpuSampleMs, sleep),
    createMemoryCollector(probe),
    ...config.diskPaths.map((path) => createDiskCollector(probe, path)),
  ];
}

export type { Collector } from './types.js';
