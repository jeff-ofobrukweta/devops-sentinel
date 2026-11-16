import type {
  ContainerCpuSnapshot,
  ContainerMemory,
  CpuTimes,
  DiskStats,
  MemorySnapshot,
  SystemProbe,
} from '../../src/platform/probe.js';
import type { HostInfo } from '../../src/types.js';

/** One core whose cumulative counters show `busy` ms of work and `idle` ms idle. */
export const core = (idle: number, busy: number): CpuTimes => ({ user: busy, nice: 0, sys: 0, idle, irq: 0 });

export interface FakeProbeOptions {
  /** Successive os.cpus() snapshots; the last one repeats once exhausted. */
  cpuSamples?: CpuTimes[][];
  loadAverage?: [number, number, number];
  /** Successive cgroup CPU snapshots; the last one repeats. Omit for "no quota". */
  containerCpu?: ContainerCpuSnapshot[];
  memory?: MemorySnapshot | Error;
  containerMemory?: ContainerMemory | null | Error;
  disks?: Record<string, DiskStats | Error>;
  host?: Partial<HostInfo>;
}

const GIB = 1024 ** 3;

export function createFakeProbe(options: FakeProbeOptions = {}): SystemProbe {
  let cpuCalls = 0;
  let containerCpuCalls = 0;
  const containerCpu = options.containerCpu ?? [];
  // Without explicit samples, counters advance like a real machine at 10% busy.
  const nextCpuSample = () => {
    if (!options.cpuSamples) return [core(900 * cpuCalls, 100 * cpuCalls++)];
    return options.cpuSamples[Math.min(cpuCalls++, options.cpuSamples.length - 1)] ?? [];
  };
  const resolveOrThrow = <T>(value: T | Error): Promise<T> =>
    value instanceof Error ? Promise.reject(value) : Promise.resolve(value);

  return {
    cpuTimes: nextCpuSample,
    loadAverage: () => options.loadAverage ?? [0.5, 0.4, 0.3],
    containerCpu: async () => containerCpu[Math.min(containerCpuCalls++, containerCpu.length - 1)] ?? null,
    memory: () => resolveOrThrow(options.memory ?? { totalBytes: 16 * GIB, availableBytes: 12 * GIB, source: 'os' }),
    containerMemory: () => resolveOrThrow(options.containerMemory ?? null),
    diskStats: (path) => {
      const disk = options.disks?.[path] ?? { bsize: 4096, blocks: 1_000_000, bfree: 700_000, bavail: 650_000 };
      return resolveOrThrow(disk);
    },
    hostInfo: async () => ({ hostname: 'test-host', platform: 'linux', arch: 'x64', containerized: false, ...options.host }),
  };
}

/** A Sleep that resolves immediately so collectors run without real delays. */
export const instantSleep = async () => {};
