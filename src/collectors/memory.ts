import type { SystemProbe } from '../platform/probe.js';
import type { MetricReading } from '../types.js';
import { type Collector, toPercent } from './types.js';

function reading(usedBytes: number, totalBytes: number, source: string): MetricReading {
  if (!(totalBytes > 0)) throw new Error(`Total memory reported as ${totalBytes} bytes`);
  return {
    kind: 'memory',
    name: 'memory',
    value: toPercent(usedBytes / totalBytes),
    details: { usedBytes, totalBytes, source },
  };
}

/**
 * Prefers the container's cgroup memory limit when one applies, because
 * os.totalmem() inside a container reports the whole host (or Docker VM).
 */
export function createMemoryCollector(probe: SystemProbe): Collector {
  return {
    kind: 'memory',
    name: 'memory',
    async collect() {
      const container = await probe.containerMemory();
      if (container) return reading(container.usageBytes, container.limitBytes, 'cgroup');

      const { totalBytes, availableBytes, source } = await probe.memory();
      return reading(totalBytes - availableBytes, totalBytes, source);
    },
  };
}
