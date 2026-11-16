import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../src/logging/logger.js';
import { renderJson } from '../../src/reporting/json.js';
import { formatBytes, renderText } from '../../src/reporting/text.js';
import type { HealthReport } from '../../src/types.js';
import { errorMessage, sleep, TimeoutError, withTimeout } from '../../src/util/async.js';

const GIB = 1024 ** 3;
const report: HealthReport = {
  schemaVersion: 1,
  timestamp: '2026-01-01T00:00:00.000Z',
  host: { hostname: 'build-01', platform: 'linux', arch: 'x64', containerized: true },
  overall: 'unknown',
  metrics: [
    {
      kind: 'cpu',
      name: 'cpu',
      status: 'healthy',
      value: 12.5,
      unit: '%',
      thresholds: { warning: 75, critical: 90 },
      details: { cores: 4, loadAverage1m: 0.5, loadAverage5m: 0.4, loadAverage15m: 0.3 },
    },
    {
      kind: 'memory',
      name: 'memory',
      status: 'warning',
      value: 85,
      unit: '%',
      thresholds: { warning: 80, critical: 90 },
      details: { usedBytes: 3.4 * GIB, totalBytes: 4 * GIB, source: 'cgroup' },
    },
    {
      kind: 'disk',
      name: 'disk:/',
      status: 'critical',
      value: 95,
      unit: '%',
      thresholds: { warning: 80, critical: 90 },
      details: { usedBytes: 95 * GIB, availableBytes: 5 * GIB },
    },
    {
      kind: 'disk',
      name: 'disk:/missing',
      status: 'unknown',
      value: null,
      unit: '%',
      thresholds: { warning: 80, critical: 90 },
      details: {},
      error: 'ENOENT: no such file or directory',
    },
  ],
};

describe('renderText', () => {
  it('renders an aligned table', () => {
    expect(renderText(report, { color: false })).toMatchInlineSnapshot(`
      "DevOps Sentinel  2026-01-01T00:00:00.000Z
      Host: build-01 (linux/x64)  Container: yes

      METRIC         STATUS    VALUE  WARN  CRIT  DETAILS
      cpu            HEALTHY   12.5%  75%   90%   4 cores, load 0.5 / 0.4 / 0.3
      memory         WARNING   85.0%  80%   90%   3.4 GiB / 4.0 GiB (cgroup)
      disk:/         CRITICAL  95.0%  80%   90%   95.0 GiB used, 5.0 GiB free
      disk:/missing  UNKNOWN   -      80%   90%   ENOENT: no such file or directory

      Overall: UNKNOWN"
    `);
  });

  it('describes CPU capacity as a quota when measured from the cgroup', () => {
    const [cpu] = report.metrics;
    const quotaReport = {
      ...report,
      metrics: [{ ...cpu!, details: { ...cpu!.details, source: 'cgroup', limitCpus: 0.5 } }],
    };
    expect(renderText(quotaReport, { color: false })).toContain('of 0.5 CPU quota, load 0.5 / 0.4 / 0.3');
  });

  it('colours statuses only when asked', () => {
    expect(renderText(report, { color: true })).toContain('\u001b[31mCRITICAL\u001b[0m');
    expect(renderText(report, { color: false })).not.toContain('\u001b[');
  });

  it('formats bytes as GiB, or MiB below 1 GiB', () => {
    expect(formatBytes(1.5 * GIB)).toBe('1.5 GiB');
    expect(formatBytes(256 * 1024 ** 2)).toBe('256 MiB');
  });
});

describe('renderJson', () => {
  it('pretty-prints for single runs and uses one line for streams', () => {
    expect(renderJson(report, true)).toContain('\n  "schemaVersion": 1');
    expect(renderJson(report, false)).not.toContain('\n');
    expect(JSON.parse(renderJson(report, false))).toEqual(report);
  });
});

describe('createLogger', () => {
  const now = () => new Date('2026-01-01T00:00:00.000Z');

  it('writes JSON lines at or above the configured level', () => {
    const lines: string[] = [];
    const logger = createLogger('warn', (line) => lines.push(line), now);
    logger.info('hidden');
    logger.warn('shown', { metric: 'cpu' });
    logger.error('also shown');
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      { time: '2026-01-01T00:00:00.000Z', level: 'warn', message: 'shown', metric: 'cpu' },
      { time: '2026-01-01T00:00:00.000Z', level: 'error', message: 'also shown' },
    ]);
  });

  it('writes nothing when silent', () => {
    const write = vi.fn();
    const logger = createLogger('silent', write);
    logger.error('nope');
    expect(write).not.toHaveBeenCalled();
  });
});

describe('async helpers', () => {
  afterEach(() => vi.useRealTimers());

  it('sleep resolves early when aborted, and immediately if already aborted', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const pending = sleep(60_000, controller.signal);
    controller.abort();
    await expect(pending).resolves.toBeUndefined();
    await expect(sleep(60_000, controller.signal)).resolves.toBeUndefined();
  });

  it('withTimeout returns the task result when it finishes in time', async () => {
    await expect(withTimeout(async () => 42, 1000, 'task')).resolves.toBe(42);
  });

  it('withTimeout rejects with a TimeoutError', async () => {
    vi.useFakeTimers();
    const pending = withTimeout(() => new Promise(() => {}), 500, 'slow');
    const assertion = expect(pending).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
  });

  it('errorMessage handles non-Error values', () => {
    expect(errorMessage(new Error('x'))).toBe('x');
    expect(errorMessage('plain')).toBe('plain');
  });
});
