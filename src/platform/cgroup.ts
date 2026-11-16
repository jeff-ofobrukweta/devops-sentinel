import type { ContainerMemory } from './probe.js';

/**
 * Parses cgroup v2 cpu.max ("<quota> <period>" in microseconds, quota "max"
 * when unlimited) into the number of CPUs the group may use, e.g. "50000 100000" → 0.5.
 */
export function parseCpuMax(text: string): number | null {
  const [quota, period] = text.trim().split(/\s+/);
  if (quota === undefined || quota === 'max') return null;
  const limit = Number(quota) / Number(period);
  return Number.isFinite(limit) && limit > 0 ? limit : null;
}

/** Extracts cumulative CPU time from cgroup v2 cpu.stat. */
export function parseCpuUsageMicros(stat: string): number | null {
  const usage = /^usage_usec (\d+)$/m.exec(stat)?.[1];
  return usage === undefined ? null : Number(usage);
}

/**
 * Interprets cgroup v2 memory files. Mirrors `docker stats` by excluding
 * inactive file-backed page cache, which the kernel can reclaim on demand.
 *
 * @param max      contents of memory.max ("max" means no limit)
 * @param current  contents of memory.current
 * @param stat     contents of memory.stat
 * @param hostTotal total memory visible to the kernel; caps a limit set above it
 */
export function parseCgroupMemory(
  max: string,
  current: string,
  stat: string,
  hostTotal: number,
): ContainerMemory | null {
  const rawLimit = max.trim();
  if (rawLimit === 'max') return null;

  const limit = Number(rawLimit);
  const usage = Number(current.trim());
  if (!Number.isFinite(limit) || limit <= 0 || !Number.isFinite(usage)) return null;

  const inactiveFile = /^inactive_file (\d+)$/m.exec(stat)?.[1];
  const reclaimable = inactiveFile === undefined ? 0 : Number(inactiveFile);

  return {
    limitBytes: hostTotal > 0 ? Math.min(limit, hostTotal) : limit,
    usageBytes: Math.max(0, usage - reclaimable),
  };
}
