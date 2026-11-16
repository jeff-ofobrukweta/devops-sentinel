import { execFile, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { HealthReport } from '../../src/types.js';

/**
 * Runs the compiled CLI against the real operating system. Metric values vary
 * from machine to machine, so these tests assert shape and ranges, never exact numbers.
 */
const CLI = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
const VERSION = (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string })
  .version;

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[]): Promise<CliResult> {
  return new Promise((resolve) => {
    execFile(process.execPath, [CLI, ...args], { env: { PATH: process.env.PATH } }, (error, stdout, stderr) => {
      const code = error && typeof error.code === 'number' ? error.code : 0;
      resolve({ code, stdout, stderr });
    });
  });
}

describe('dist/cli.js on the real system', () => {
  it('produces a well-formed JSON report and a status exit code', async () => {
    const { code, stdout } = await runCli(['--once', '--format', 'json', '--sample-ms', '200']);
    const report = JSON.parse(stdout) as HealthReport;

    expect([0, 1, 2, 3]).toContain(code);
    expect(report.schemaVersion).toBe(1);
    expect(report.host.platform).toBe(process.platform);
    expect(report.metrics.map((metric) => metric.name)).toEqual(['cpu', 'memory', 'disk:/']);
    for (const metric of report.metrics) {
      if (metric.status === 'unknown') continue;
      expect(metric.value).toBeGreaterThanOrEqual(0);
      expect(metric.value).toBeLessThanOrEqual(100);
    }
  });

  it('produces a text report', async () => {
    const { stdout } = await runCli(['--once', '--no-color', '--sample-ms', '200']);
    expect(stdout).toMatch(/^Overall: (HEALTHY|WARNING|CRITICAL|UNKNOWN)$/m);
  });

  it('reports a missing disk path as unknown without failing other metrics', async () => {
    const { stdout } = await runCli(['--once', '--format', 'json', '--disk-path', '/definitely/not/here']);
    const report = JSON.parse(stdout) as HealthReport;
    const disk = report.metrics.find((metric) => metric.name === 'disk:/definitely/not/here');
    expect(disk).toMatchObject({ status: 'unknown', value: null });
    expect(disk?.error).toMatch(/ENOENT/);
    expect(report.metrics.find((metric) => metric.name === 'cpu')?.status).not.toBe('unknown');
  });

  it('exits 64 for an unknown flag', async () => {
    const { code, stderr } = await runCli(['--bogus']);
    expect(code).toBe(64);
    expect(stderr).toMatch(/bogus/);
  });

  it('prints the package version', async () => {
    expect((await runCli(['--version'])).stdout.trim()).toBe(VERSION);
  });

  it('stops cleanly within 2 seconds of SIGTERM in continuous mode', async () => {
    const child = spawn(process.execPath, [CLI, '--format', 'json', '--interval', '60', '--sample-ms', '200']);
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));

    // Wait for the first report so we know the monitor loop is running.
    await new Promise<void>((resolve) => child.stdout.once('data', () => resolve()));
    const sentAt = Date.now();
    child.kill('SIGTERM');
    const code = await new Promise<number | null>((resolve) => child.on('exit', resolve));

    expect(code).toBe(0);
    expect(Date.now() - sentAt).toBeLessThan(2000);
    expect(stderr).toContain('Monitoring stopped');
  });
});
