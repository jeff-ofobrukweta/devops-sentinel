import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Collector } from '../../src/collectors/index.js';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { runCycle } from '../../src/monitor/cycle.js';
import { runMonitor } from '../../src/monitor/service.js';
import type { HealthReport } from '../../src/types.js';
import { sleep } from '../../src/util/async.js';

const host = { hostname: 'h', platform: 'linux', arch: 'x64', containerized: false };
const now = () => new Date('2026-01-01T00:00:00.000Z');

const fixed = (name: string, value: number): Collector => ({
  kind: 'cpu',
  name,
  collect: async () => ({ kind: 'cpu', name, value, details: {} }),
});

const neverResolves: Collector = {
  kind: 'memory',
  name: 'memory',
  collect: (signal) =>
    new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('collector saw abort')))),
};

describe('runCycle', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const options = (collectors: Collector[]) => ({
    collectors,
    thresholds: DEFAULT_CONFIG.thresholds,
    timeoutMs: 1000,
    host,
    now,
  });

  it('evaluates every collector and computes the overall status', async () => {
    const report = await runCycle(options([fixed('a', 10), fixed('b', 80)]));
    expect(report.metrics.map((metric) => metric.status)).toEqual(['healthy', 'warning']);
    expect(report.overall).toBe('warning');
    expect(report.timestamp).toBe('2026-01-01T00:00:00.000Z');
  });

  it('turns a failing collector into an unknown metric without affecting the others', async () => {
    const failing: Collector = { kind: 'disk', name: 'disk:/x', collect: async () => Promise.reject(new Error('EACCES')) };
    const report = await runCycle(options([fixed('a', 10), failing]));
    expect(report.metrics[1]).toMatchObject({ status: 'unknown', value: null, error: 'EACCES' });
    expect(report.overall).toBe('unknown');
  });

  it('times out a hanging collector and aborts its signal', async () => {
    const pending = runCycle(options([fixed('a', 10), neverResolves]));
    await vi.advanceTimersByTimeAsync(1000);
    const report = await pending;
    expect(report.metrics[1]).toMatchObject({ status: 'unknown', error: 'memory timed out after 1000 ms' });
  });

  it('forwards a parent abort to collectors', async () => {
    const controller = new AbortController();
    const pending = runCycle(options([neverResolves]), controller.signal);
    controller.abort();
    const report = await pending;
    expect(report.metrics[0]?.status).toBe('unknown');
  });
});

describe('runMonitor', () => {
  beforeEach(() => vi.useFakeTimers({ now: 0 }));
  afterEach(() => vi.useRealTimers());

  const report = { overall: 'healthy' } as HealthReport;

  it('runs a cycle every interval until aborted', async () => {
    const controller = new AbortController();
    const onReport = vi.fn();
    const done = runMonitor({
      intervalMs: 10_000,
      signal: controller.signal,
      check: async () => report,
      onReport,
      onError: vi.fn(),
      sleep,
      now: Date.now,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(onReport).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(onReport).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(onReport).toHaveBeenCalledTimes(2);

    controller.abort();
    await expect(done).resolves.toBe(2);
  });

  it('never overlaps cycles and measures the interval from the start of each cycle', async () => {
    const controller = new AbortController();
    let running = 0;
    let maxConcurrent = 0;
    const starts: number[] = [];
    const check = async () => {
      starts.push(Date.now());
      running += 1;
      maxConcurrent = Math.max(maxConcurrent, running);
      await sleep(3_000); // a slow cycle
      running -= 1;
      return report;
    };
    const done = runMonitor({
      intervalMs: 5_000,
      signal: controller.signal,
      check,
      onReport: () => {},
      onError: () => {},
      sleep,
      now: Date.now,
    });

    await vi.advanceTimersByTimeAsync(15_000);
    controller.abort();
    await vi.advanceTimersByTimeAsync(3_000);
    await done;

    expect(maxConcurrent).toBe(1);
    expect(starts).toEqual([0, 5_000, 10_000, 15_000]);
  });

  it('logs a failed cycle and keeps going', async () => {
    const controller = new AbortController();
    const onError = vi.fn();
    const onReport = vi.fn();
    const check = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(report);
    const done = runMonitor({ intervalMs: 1_000, signal: controller.signal, check, onReport, onError, sleep, now: Date.now });

    await vi.advanceTimersByTimeAsync(1_000);
    controller.abort();
    await done;

    expect(onError).toHaveBeenCalledWith(new Error('boom'));
    expect(onReport).toHaveBeenCalledTimes(1);
  });

  it('discards a report that completes after shutdown was requested', async () => {
    const controller = new AbortController();
    const onReport = vi.fn();
    const onError = vi.fn();
    const done = runMonitor({
      intervalMs: 1_000,
      signal: controller.signal,
      check: async () => {
        controller.abort();
        return report;
      },
      onReport,
      onError,
      sleep,
      now: Date.now,
    });
    await expect(done).resolves.toBe(0);
    expect(onReport).not.toHaveBeenCalled();
  });

  it('does not report an error caused by shutdown', async () => {
    const controller = new AbortController();
    const onError = vi.fn();
    const done = runMonitor({
      intervalMs: 1_000,
      signal: controller.signal,
      check: async () => {
        controller.abort();
        throw new Error('aborted');
      },
      onReport: () => {},
      onError,
      sleep,
      now: Date.now,
    });
    await done;
    expect(onError).not.toHaveBeenCalled();
  });
});
