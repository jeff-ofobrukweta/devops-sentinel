import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ContainerCpuSnapshot, ContainerMemory, DiskStats, MemorySnapshot } from '../src/platform/probe.js';
import type { HealthReport, HealthState } from '../src/types.js';
import { core, createFakeProbe } from './helpers/fakeProbe.js';
import { runApp } from './helpers/runApp.js';

/**
 * Each JSON file in tests/fixtures/scenarios describes a simulated machine
 * state and the report it must produce. Adding a scenario needs no code.
 */
interface Scenario {
  description: string;
  args?: string[];
  probe: {
    cpu?: { idle: number; busy: number }[][];
    containerCpu?: ContainerCpuSnapshot[];
    memory?: MemorySnapshot | { error: string };
    containerMemory?: ContainerMemory | null;
    disks?: Record<string, DiskStats | { error: string }>;
    containerized?: boolean;
  };
  expected: { overall: HealthState; exitCode: number; statuses: Record<string, HealthState> };
}

const dir = new URL('./fixtures/scenarios/', import.meta.url);
const scenarios = readdirSync(dir)
  .filter((file) => file.endsWith('.json'))
  .map((file) => [file, JSON.parse(readFileSync(new URL(file, dir), 'utf8')) as Scenario] as const);

const orError = <T extends object>(value: T | { error: string }): T | Error =>
  'error' in value ? new Error(value.error) : value;

function probeFor({ probe }: Scenario) {
  return createFakeProbe({
    ...(probe.cpu && { cpuSamples: probe.cpu.map((sample) => sample.map(({ idle, busy }) => core(idle, busy))) }),
    ...(probe.containerCpu && { containerCpu: probe.containerCpu }),
    ...(probe.memory && { memory: orError(probe.memory) }),
    ...(probe.containerMemory !== undefined && { containerMemory: probe.containerMemory }),
    ...(probe.disks && {
      disks: Object.fromEntries(Object.entries(probe.disks).map(([path, disk]) => [path, orError(disk)])),
    }),
    host: { containerized: probe.containerized ?? false },
  });
}

describe('sample-data scenarios', () => {
  it('found scenario fixtures', () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(5);
  });

  describe.each(scenarios)('%s', (_file, scenario) => {
    it(`${scenario.description}: JSON report and exit code`, async () => {
      const result = await runApp(['--once', '--format', 'json', ...(scenario.args ?? [])], { probe: probeFor(scenario) });
      const report = JSON.parse(result.stdout) as HealthReport;

      expect(report.overall).toBe(scenario.expected.overall);
      expect(result.exitCode).toBe(scenario.expected.exitCode);
      expect(Object.fromEntries(report.metrics.map((metric) => [metric.name, metric.status]))).toEqual(
        scenario.expected.statuses,
      );
      for (const metric of report.metrics) {
        if (metric.status === 'unknown') expect(metric.error).toBeTruthy();
        else expect(metric.value).toBeGreaterThanOrEqual(0);
      }
    });

    it(`${scenario.description}: text report`, async () => {
      const result = await runApp(['--once', ...(scenario.args ?? [])], { probe: probeFor(scenario) });
      expect(result.stdout).toContain(`Overall: ${scenario.expected.overall.toUpperCase()}`);
    });
  });
});
