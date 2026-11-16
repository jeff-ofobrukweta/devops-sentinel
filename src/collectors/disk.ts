import type { DiskStats, SystemProbe } from '../platform/probe.js';
import { type Collector, toPercent } from './types.js';

/**
 * Matches `df`: blocks reserved for root (bfree − bavail) are excluded from
 * the denominator, so a disk shows 100% when unprivileged users cannot write.
 */
export function diskUtilisation(stats: DiskStats) {
  const usedBlocks = stats.blocks - stats.bfree;
  const usableBlocks = usedBlocks + stats.bavail;
  if (usableBlocks <= 0) throw new Error('Filesystem reports no usable blocks');

  return {
    percent: toPercent(usedBlocks / usableBlocks),
    usedBytes: usedBlocks * stats.bsize,
    availableBytes: stats.bavail * stats.bsize,
    totalBytes: stats.blocks * stats.bsize,
  };
}

export function createDiskCollector(probe: SystemProbe, path: string): Collector {
  const name = `disk:${path}`;
  return {
    kind: 'disk',
    name,
    async collect() {
      const { percent, ...details } = diskUtilisation(await probe.diskStats(path));
      return { kind: 'disk', name, value: percent, details: { path, ...details } };
    },
  };
}
