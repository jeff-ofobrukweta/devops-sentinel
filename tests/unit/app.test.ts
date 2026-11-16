import { describe, expect, it } from 'vitest';
import { HELP } from '../../src/app.js';
import type { Sleep } from '../../src/util/async.js';
import { createFakeProbe } from '../helpers/fakeProbe.js';
import { logLines, runApp } from '../helpers/runApp.js';

describe('main', () => {
  it('prints help', async () => {
    expect(await runApp(['--help'])).toEqual({ exitCode: 0, stdout: HELP, stderr: '' });
  });

  it('prints the version', async () => {
    expect((await runApp(['--version'])).stdout).toBe('9.9.9\n');
  });

  it('exits 64 with a readable message for invalid configuration', async () => {
    const result = await runApp(['--interval', '0']);
    expect(result.exitCode).toBe(64);
    expect(result.stderr).toContain('intervalSeconds must be between 1 and 86400');
    expect(result.stderr).toContain('--help');
  });

  it('prints the resolved configuration', async () => {
    const result = await runApp(['--print-config', '--disk-warning', '70'], { env: { SENTINEL_FORMAT: 'json' } });
    expect(JSON.parse(result.stdout)).toMatchObject({ format: 'json', thresholds: { disk: { warning: 70 } } });
  });

  it('renders a text report in single-run mode and returns the status exit code', async () => {
    const result = await runApp(['--once']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Overall: HEALTHY');
    expect(result.stdout).not.toContain('\u001b[');
  });

  it('uses colour automatically when stdout is a terminal', async () => {
    expect((await runApp(['--once'], { stdoutIsTTY: true })).stdout).toContain('\u001b[32m');
  });

  it('logs collection failures at debug level', async () => {
    const probe = createFakeProbe({ disks: { '/': new Error('EACCES') } });
    const result = await runApp(['--once', '--log-level', 'debug'], { probe });
    expect(result.exitCode).toBe(3);
    expect(logLines(result.stderr)).toContainEqual(
      expect.objectContaining({ level: 'debug', metric: 'disk:/', error: 'EACCES' }),
    );
  });

  it('monitors continuously, streams NDJSON, alerts on changes and stops on shutdown', async () => {
    let shutdown = () => {};
    let intervalWaits = 0;
    // Sleep serves both the CPU sampling window (1000 ms) and the wait between
    // cycles; the second between-cycle wait simulates the operator pressing Ctrl-C.
    const sleep: Sleep = async (ms) => {
      if (ms === 1000) return;
      intervalWaits += 1;
      if (intervalWaits === 2) shutdown();
    };
    const probe = createFakeProbe({ memory: { totalBytes: 100, availableBytes: 10, source: 'os' } });

    const result = await runApp(['--format', 'json', '--interval', '5'], {
      probe,
      sleep,
      onShutdown: (handler) => {
        shutdown = handler;
        return () => {};
      },
    });

    expect(result.exitCode).toBe(0);
    const reports = result.stdout.trim().split('\n').map((line) => JSON.parse(line));
    expect(reports).toHaveLength(2);
    expect(reports.every((report) => report.overall === 'critical')).toBe(true);

    const logs = logLines(result.stderr);
    expect(logs[0]).toMatchObject({ level: 'info', message: 'Monitoring started' });
    // Memory is critical on every cycle, but only one alert is raised.
    expect(logs.filter((log) => log.alert)).toEqual([
      expect.objectContaining({ level: 'error', message: 'memory is critical (90%)' }),
    ]);
    expect(logs.at(-1)).toMatchObject({ message: 'Monitoring stopped' });
  });

  it('separates text reports with a blank line in continuous mode', async () => {
    let shutdown = () => {};
    const result = await runApp(['--interval', '5'], {
      sleep: async (ms) => {
        if (ms !== 1000) shutdown();
      },
      onShutdown: (handler) => {
        shutdown = handler;
        return () => {};
      },
    });
    expect(result.stdout.endsWith('Overall: HEALTHY\n\n')).toBe(true);
  });
});
