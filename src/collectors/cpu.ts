import type { ContainerCpuSnapshot, CpuTimes, SystemProbe } from '../platform/probe.js';
import type { MetricDetails } from '../types.js';
import type { Sleep } from '../util/async.js';
import { type Collector, toPercent } from './types.js';

function totals(cores: readonly CpuTimes[]): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const core of cores) {
    idle += core.idle;
    total += core.user + core.nice + core.sys + core.idle + core.irq;
  }
  return { idle, total };
}

/**
 * os.cpus() times are cumulative since boot, so utilisation must be derived
 * from the difference between two samples: busy = 1 - Δidle / Δtotal.
 */
export function cpuUtilisation(before: readonly CpuTimes[], after: readonly CpuTimes[]): number {
  if (before.length === 0) throw new Error('No CPU information available from the operating system');
  if (before.length !== after.length) {
    throw new Error(`CPU core count changed between samples (${before.length} → ${after.length})`);
  }
  const start = totals(before);
  const end = totals(after);
  const idleDelta = end.idle - start.idle;
  const totalDelta = end.total - start.total;

  if (idleDelta < 0 || totalDelta < 0) throw new Error('CPU counters went backwards between samples');
  if (totalDelta === 0) throw new Error('No CPU time elapsed between samples; increase cpuSampleMs');

  return toPercent(1 - idleDelta / totalDelta);
}

/**
 * Utilisation of a container's CPU quota: CPU time consumed divided by the
 * CPU time the quota allowed over the same wall-clock interval. Scheduler
 * accounting can briefly exceed the quota, so the result is capped at 100%.
 */
export function cgroupCpuUtilisation(before: ContainerCpuSnapshot, after: ContainerCpuSnapshot): number {
  const elapsed = after.takenAtMicros - before.takenAtMicros;
  const used = after.usageMicros - before.usageMicros;
  if (elapsed <= 0) throw new Error('No time elapsed between container CPU samples; increase cpuSampleMs');
  if (used < 0) throw new Error('Container CPU usage counter went backwards between samples');
  return toPercent(used / (elapsed * after.limitCpus));
}

export function createCpuCollector(probe: SystemProbe, sampleMs: number, sleep: Sleep): Collector {
  return {
    kind: 'cpu',
    name: 'cpu',
    async collect(signal) {
      const containerBefore = await probe.containerCpu();
      const before = probe.cpuTimes();
      await sleep(sampleMs, signal);
      signal.throwIfAborted();
      const after = probe.cpuTimes();
      const containerAfter = containerBefore ? await probe.containerCpu() : null;
      const [load1, load5, load15] = probe.loadAverage();

      const details: MetricDetails = {
        cores: after.length,
        sampleMs,
        loadAverage1m: Number(load1.toFixed(2)),
        loadAverage5m: Number(load5.toFixed(2)),
        loadAverage15m: Number(load15.toFixed(2)),
      };

      if (containerBefore && containerAfter) {
        return {
          kind: 'cpu',
          name: 'cpu',
          value: cgroupCpuUtilisation(containerBefore, containerAfter),
          details: { ...details, limitCpus: containerAfter.limitCpus, source: 'cgroup' },
        };
      }
      return { kind: 'cpu', name: 'cpu', value: cpuUtilisation(before, after), details: { ...details, source: 'os' } };
    },
  };
}
