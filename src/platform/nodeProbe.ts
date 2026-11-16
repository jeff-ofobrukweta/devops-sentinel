import { execFile } from 'node:child_process';
import { access, readFile, statfs } from 'node:fs/promises';
import os from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { parseCgroupMemory, parseCpuMax, parseCpuUsageMicros } from './cgroup.js';
import { availableBytesFromVmStat } from './darwin.js';
import type { ContainerCpuSnapshot, ContainerMemory, MemorySnapshot, SystemProbe } from './probe.js';

const execFileAsync = promisify(execFile);

const CGROUP_ROOT = '/sys/fs/cgroup';
const CONTAINER_MARKERS = ['/.dockerenv', '/run/.containerenv'];

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Heuristic: Docker creates /.dockerenv and Podman creates /run/.containerenv. */
async function isContainerized(): Promise<boolean> {
  if (process.platform !== 'linux') return false;
  const found = await Promise.all(CONTAINER_MARKERS.map(exists));
  return found.includes(true);
}

async function readContainerMemory(): Promise<ContainerMemory | null> {
  if (!(await isContainerized())) return null;
  try {
    const [max, current, stat] = await Promise.all(
      ['memory.max', 'memory.current', 'memory.stat'].map((file) =>
        readFile(join(CGROUP_ROOT, file), 'utf8'),
      ),
    );
    return parseCgroupMemory(max ?? '', current ?? '', stat ?? '', os.totalmem());
  } catch {
    // cgroup v1 hosts or restricted mounts: fall back to os.* figures.
    return null;
  }
}

async function readContainerCpu(): Promise<ContainerCpuSnapshot | null> {
  if (!(await isContainerized())) return null;
  try {
    const [max, stat] = await Promise.all(
      ['cpu.max', 'cpu.stat'].map((file) => readFile(join(CGROUP_ROOT, file), 'utf8')),
    );
    const takenAtMicros = Number(process.hrtime.bigint() / 1000n);
    const limitCpus = parseCpuMax(max ?? '');
    const usageMicros = parseCpuUsageMicros(stat ?? '');
    if (limitCpus === null || usageMicros === null) return null;
    return { usageMicros, limitCpus, takenAtMicros };
  } catch {
    return null;
  }
}

async function readMemory(): Promise<MemorySnapshot> {
  const totalBytes = os.totalmem();
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execFileAsync('/usr/bin/vm_stat', { timeout: 2000 });
      return { totalBytes, availableBytes: availableBytesFromVmStat(stdout), source: 'vm_stat' };
    } catch {
      // Fall through to os.freemem(); the "os" source label signals reduced accuracy.
    }
  }
  return { totalBytes, availableBytes: os.freemem(), source: 'os' };
}

export function createNodeProbe(): SystemProbe {
  return {
    cpuTimes: () => os.cpus().map((cpu) => cpu.times),
    loadAverage: () => {
      const [one = 0, five = 0, fifteen = 0] = os.loadavg();
      return [one, five, fifteen];
    },
    containerCpu: readContainerCpu,
    memory: readMemory,
    containerMemory: readContainerMemory,
    diskStats: async (path) => {
      const stats = await statfs(path);
      return { bsize: stats.bsize, blocks: stats.blocks, bfree: stats.bfree, bavail: stats.bavail };
    },
    hostInfo: async () => ({
      hostname: os.hostname(),
      platform: process.platform,
      arch: process.arch,
      containerized: await isContainerized(),
    }),
  };
}
