import { describe, expect, it, vi } from 'vitest';
import { AlertService } from '../../src/alerts/service.js';
import type { HealthReport, HealthState } from '../../src/types.js';

function report(states: Record<string, HealthState>, timestamp = '2026-01-01T00:00:00.000Z'): HealthReport {
  return {
    schemaVersion: 1,
    timestamp,
    host: { hostname: 'h', platform: 'linux', arch: 'x64', containerized: false },
    overall: 'healthy',
    metrics: Object.entries(states).map(([name, status]) => ({
      kind: 'cpu',
      name,
      status,
      value: status === 'unknown' ? null : 50,
      unit: '%',
      thresholds: { warning: 75, critical: 90 },
      details: {},
    })),
  };
}

describe('AlertService', () => {
  it('alerts only on state changes, including recovery', () => {
    const notify = vi.fn();
    const service = new AlertService(notify);
    const sequence: HealthState[] = ['healthy', 'warning', 'warning', 'critical', 'critical', 'healthy', 'healthy'];

    const alertCounts = sequence.map((state) => service.process(report({ cpu: state })).length);

    expect(alertCounts).toEqual([0, 1, 0, 1, 0, 1, 0]);
    expect(notify.mock.calls.map(([alert]) => alert.message)).toEqual([
      'cpu changed: healthy → warning (50%)',
      'cpu changed: warning → critical (50%)',
      'cpu recovered: critical → healthy (50%)',
    ]);
  });

  it('alerts immediately when a metric is first seen in a non-healthy state', () => {
    const [alert] = new AlertService(() => {}).process(report({ memory: 'critical' }));
    expect(alert).toMatchObject({ metric: 'memory', previous: null, current: 'critical', message: 'memory is critical (50%)' });
  });

  it('tracks each metric independently', () => {
    const service = new AlertService(() => {});
    service.process(report({ cpu: 'healthy', 'disk:/': 'healthy' }));
    const alerts = service.process(report({ cpu: 'healthy', 'disk:/': 'unknown' }));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.message).toBe('disk:/ changed: healthy → unknown (no reading)');
  });
});
