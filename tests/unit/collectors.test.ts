import { describe, expect, it, vi } from 'vitest';
import { cgroupCpuUtilisation, createCpuCollector, cpuUtilisation } from '../../src/collectors/cpu.js';
import { createDiskCollector, diskUtilisation } from '../../src/collectors/disk.js';
import { buildCollectors } from '../../src/collectors/index.js';
import { createMemoryCollector } from '../../src/collectors/memory.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { core, createFakeProbe, instantSleep } from '../helpers/fakeProbe.js';

const signal = new AbortController().signal;

describe('cpuUtilisation', () => {
  it('derives utilisation from the difference between two samples', () => {
    // Δidle = 250, Δtotal = 1000 across two cores → 75% busy.
    const before = [core(1000, 1000), core(1000, 1000)];
    const after = [core(1100, 1400), core(1150, 1350)];
    expect(cpuUtilisation(before, after)).toBe(75);
  });

  it('reports 0% for a fully idle interval', () => {
    expect(cpuUtilisation([core(0, 0)], [core(500, 0)])).toBe(0);
  });

  it('rounds to two decimal places', () => {
    expect(cpuUtilisation([core(0, 0)], [core(2, 1)])).toBe(33.33);
  });

  it('rejects an interval with no elapsed CPU time instead of dividing by zero', () => {
    expect(() => cpuUtilisation([core(10, 10)], [core(10, 10)])).toThrow(/No CPU time elapsed/);
  });

  it('rejects counters that went backwards', () => {
    expect(() => cpuUtilisation([core(100, 100)], [core(50, 200)])).toThrow(/backwards/);
  });

  it('rejects a change in core count', () => {
    expect(() => cpuUtilisation([core(1, 1)], [core(2, 2), core(2, 2)])).toThrow(/core count changed/);
  });

  it('rejects empty CPU information', () => {
    expect(() => cpuUtilisation([], [])).toThrow(/No CPU information/);
  });
});

describe('cgroupCpuUtilisation', () => {
  const snapshot = (usageMicros: number, takenAtMicros: number, limitCpus = 0.5) => ({
    usageMicros,
    takenAtMicros,
    limitCpus,
  });

  it('measures usage against the quota, not against every core', () => {
    // 0.5 CPU quota for 1 s allows 500 000 µs; 400 000 µs used → 80%.
    expect(cgroupCpuUtilisation(snapshot(0, 0), snapshot(400_000, 1_000_000))).toBe(80);
  });

  it('caps short scheduler bursts above the quota at 100%', () => {
    expect(cgroupCpuUtilisation(snapshot(0, 0), snapshot(550_000, 1_000_000))).toBe(100);
  });

  it('rejects zero elapsed time and counters going backwards', () => {
    expect(() => cgroupCpuUtilisation(snapshot(0, 5), snapshot(10, 5))).toThrow(/No time elapsed/);
    expect(() => cgroupCpuUtilisation(snapshot(10, 0), snapshot(5, 100))).toThrow(/backwards/);
  });
});

describe('createCpuCollector', () => {
  it('uses the cgroup quota when the container has one', async () => {
    const probe = createFakeProbe({
      containerCpu: [
        { usageMicros: 1_000_000, limitCpus: 2, takenAtMicros: 0 },
        { usageMicros: 1_500_000, limitCpus: 2, takenAtMicros: 1_000_000 },
      ],
    });
    const reading = await createCpuCollector(probe, 1000, instantSleep).collect(signal);
    expect(reading.value).toBe(25);
    expect(reading.details).toMatchObject({ source: 'cgroup', limitCpus: 2 });
  });

  it('falls back to os.cpus() when no quota applies', async () => {
    const reading = await createCpuCollector(createFakeProbe(), 1000, instantSleep).collect(signal);
    expect(reading.details.source).toBe('os');
  });

  it('samples, waits for the window, samples again and adds load averages', async () => {
    const probe = createFakeProbe({ cpuSamples: [[core(0, 0)], [core(900, 100)]], loadAverage: [1.234, 2, 3] });
    const sleep = vi.fn(instantSleep);
    const reading = await createCpuCollector(probe, 250, sleep).collect(signal);

    expect(sleep).toHaveBeenCalledWith(250, signal);
    expect(reading).toMatchObject({ kind: 'cpu', name: 'cpu', value: 10 });
    expect(reading.details).toMatchObject({ cores: 1, sampleMs: 250, loadAverage1m: 1.23 });
  });

  it('stops if aborted during the sampling window', async () => {
    const controller = new AbortController();
    const sleep = async () => controller.abort(new Error('shutting down'));
    await expect(createCpuCollector(createFakeProbe(), 1000, sleep).collect(controller.signal)).rejects.toThrow(
      'shutting down',
    );
  });
});

describe('createMemoryCollector', () => {
  it('computes used memory from total minus available', async () => {
    const probe = createFakeProbe({ memory: { totalBytes: 1000, availableBytes: 150, source: 'vm_stat' } });
    const reading = await createMemoryCollector(probe).collect(signal);
    expect(reading.value).toBe(85);
    expect(reading.details).toEqual({ usedBytes: 850, totalBytes: 1000, source: 'vm_stat' });
  });

  it('prefers the cgroup limit when running in a limited container', async () => {
    const probe = createFakeProbe({ containerMemory: { limitBytes: 200, usageBytes: 50 } });
    const reading = await createMemoryCollector(probe).collect(signal);
    expect(reading.value).toBe(25);
    expect(reading.details.source).toBe('cgroup');
  });

  it('rejects a zero total', async () => {
    const probe = createFakeProbe({ memory: { totalBytes: 0, availableBytes: 0, source: 'os' } });
    await expect(createMemoryCollector(probe).collect(signal)).rejects.toThrow(/Total memory/);
  });
});

describe('diskUtilisation', () => {
  it('excludes root-reserved blocks the way df does', () => {
    // used = 1000 − 300 = 700; usable = 700 + 200 = 900 → 77.78%
    const result = diskUtilisation({ bsize: 4096, blocks: 1000, bfree: 300, bavail: 200 });
    expect(result).toEqual({
      percent: 77.78,
      usedBytes: 700 * 4096,
      availableBytes: 200 * 4096,
      totalBytes: 1000 * 4096,
    });
  });

  it('reports 100% when nothing is available to unprivileged users', () => {
    expect(diskUtilisation({ bsize: 1, blocks: 100, bfree: 5, bavail: 0 }).percent).toBe(100);
  });

  it('rejects a filesystem with no usable blocks', () => {
    expect(() => diskUtilisation({ bsize: 1, blocks: 0, bfree: 0, bavail: 0 })).toThrow(/no usable blocks/);
  });
});

describe('createDiskCollector', () => {
  it('names the metric after its path', async () => {
    const probe = createFakeProbe({ disks: { '/data': { bsize: 1, blocks: 10, bfree: 5, bavail: 5 } } });
    const reading = await createDiskCollector(probe, '/data').collect(signal);
    expect(reading).toMatchObject({ name: 'disk:/data', value: 50, details: { path: '/data' } });
  });

  it('propagates filesystem errors', async () => {
    const probe = createFakeProbe({ disks: { '/missing': new Error('ENOENT') } });
    await expect(createDiskCollector(probe, '/missing').collect(signal)).rejects.toThrow('ENOENT');
  });
});

describe('buildCollectors', () => {
  it('creates CPU, memory and one disk collector per path', () => {
    const config = { ...DEFAULT_CONFIG, diskPaths: ['/', '/data'] };
    const names = buildCollectors(config, createFakeProbe(), instantSleep).map((collector) => collector.name);
    expect(names).toEqual(['cpu', 'memory', 'disk:/', 'disk:/data']);
  });
});
