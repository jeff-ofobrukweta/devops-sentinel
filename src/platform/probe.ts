import type { HostInfo } from '../types.js';

/** Cumulative per-core CPU time in milliseconds, as returned by os.cpus(). */
export interface CpuTimes {
  user: number;
  nice: number;
  sys: number;
  idle: number;
  irq: number;
}

/** Subset of fs.statfs() fields needed to compute usage the way `df` does. */
export interface DiskStats {
  bsize: number;
  blocks: number;
  bfree: number;
  bavail: number;
}

export interface MemorySnapshot {
  totalBytes: number;
  availableBytes: number;
  /** How availableBytes was obtained, reported so readers can judge accuracy. */
  source: 'os' | 'vm_stat';
}

/** A point-in-time reading of a CPU-quota-limited container's cgroup. */
export interface ContainerCpuSnapshot {
  /** Cumulative CPU time consumed by the container (cpu.stat usage_usec). */
  usageMicros: number;
  /** CPUs the container may use, from cpu.max quota / period (e.g. 0.5). */
  limitCpus: number;
  /** Monotonic clock reading, in microseconds, taken with the usage figure. */
  takenAtMicros: number;
}

export interface ContainerMemory {
  limitBytes: number;
  usageBytes: number;
}

/**
 * The only boundary between DevOps Sentinel and the operating system.
 * Collectors depend on this interface so tests can supply controlled data.
 */
export interface SystemProbe {
  cpuTimes(): CpuTimes[];
  loadAverage(): [number, number, number];
  /** CPU usage and quota from cgroup v2, or null when no quota applies / not in a container. */
  containerCpu(): Promise<ContainerCpuSnapshot | null>;
  memory(): Promise<MemorySnapshot>;
  /** Memory limit and usage from cgroup v2, or null when not limited / not in a container. */
  containerMemory(): Promise<ContainerMemory | null>;
  diskStats(path: string): Promise<DiskStats>;
  hostInfo(): Promise<HostInfo>;
}
