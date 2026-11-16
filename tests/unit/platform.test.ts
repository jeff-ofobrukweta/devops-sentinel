import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseCgroupMemory, parseCpuMax, parseCpuUsageMicros } from '../../src/platform/cgroup.js';
import { availableBytesFromVmStat } from '../../src/platform/darwin.js';
import { createNodeProbe } from '../../src/platform/nodeProbe.js';

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');

describe('parseCgroupMemory', () => {
  const stat = 'anon 1000\nfile 5000\ninactive_file 4000\nactive_file 1000\n';

  it('returns null when no limit is set', () => {
    expect(parseCgroupMemory('max\n', '123\n', stat, 10_000)).toBeNull();
  });

  it('subtracts reclaimable inactive page cache from usage, like docker stats', () => {
    expect(parseCgroupMemory('8000\n', '6000\n', stat, 10_000)).toEqual({ limitBytes: 8000, usageBytes: 2000 });
  });

  it('caps a limit above physical memory at the host total', () => {
    expect(parseCgroupMemory('99999\n', '100\n', '', 10_000)).toEqual({ limitBytes: 10_000, usageBytes: 100 });
  });

  it('returns null for malformed values', () => {
    expect(parseCgroupMemory('lots', '1', '', 10)).toBeNull();
    expect(parseCgroupMemory('0', '1', '', 10)).toBeNull();
  });
});

describe('parseCpuMax', () => {
  it.each([
    ['50000 100000\n', 0.5],
    ['200000 100000', 2],
    ['max 100000\n', null],
    ['', null],
    ['0 100000', null],
    ['abc 100000', null],
  ])('parses %j as %s CPUs', (text, expected) => {
    expect(parseCpuMax(text)).toBe(expected);
  });
});

describe('parseCpuUsageMicros', () => {
  it('reads usage_usec', () => {
    expect(parseCpuUsageMicros('usage_usec 123456\nuser_usec 100000\nsystem_usec 23456\n')).toBe(123456);
  });

  it('returns null when the field is missing', () => {
    expect(parseCpuUsageMicros('nr_periods 0\n')).toBeNull();
  });
});

describe('availableBytesFromVmStat', () => {
  it('counts free plus inactive pages (captured on an Apple Silicon Mac)', () => {
    // 3821 free + 182155 inactive pages × 16384 bytes
    expect(availableBytesFromVmStat(fixture('vm_stat-darwin-arm64.txt'))).toBe((3821 + 182155) * 16384);
  });

  it('rejects unexpected output', () => {
    expect(() => availableBytesFromVmStat('something else')).toThrow(/Unrecognised/);
  });
});

// These call the real OS but only read information, so they are safe anywhere.
describe('createNodeProbe (real system, read-only)', () => {
  const probe = createNodeProbe();

  it('returns CPU times for at least one core', () => {
    const cores = probe.cpuTimes();
    expect(cores.length).toBeGreaterThan(0);
    expect(cores[0]).toHaveProperty('idle');
  });

  it('returns memory figures where available does not exceed total', async () => {
    const memory = await probe.memory();
    expect(memory.totalBytes).toBeGreaterThan(0);
    expect(memory.availableBytes).toBeGreaterThanOrEqual(0);
    expect(memory.availableBytes).toBeLessThanOrEqual(memory.totalBytes);
  });

  it('reads filesystem statistics for /', async () => {
    const disk = await probe.diskStats('/');
    expect(disk.blocks).toBeGreaterThan(0);
  });

  it('describes the host', async () => {
    const host = await probe.hostInfo();
    expect(host.platform).toBe(process.platform);
    expect(typeof host.containerized).toBe('boolean');
  });
});
