import type { HealthReport, HealthState } from '../types.js';

export interface Alert {
  metric: string;
  previous: HealthState | null;
  current: HealthState;
  value: number | null;
  timestamp: string;
  message: string;
}

function describe(metric: string, previous: HealthState | null, current: HealthState, value: number | null): string {
  const reading = value === null ? 'no reading' : `${value}%`;
  if (previous === null) return `${metric} is ${current} (${reading})`;
  if (current === 'healthy') return `${metric} recovered: ${previous} → healthy (${reading})`;
  return `${metric} changed: ${previous} → ${current} (${reading})`;
}

/**
 * Raises an alert only when a metric's state changes, so a sustained problem
 * produces one alert rather than one per cycle. A metric first seen in a
 * non-healthy state alerts immediately; one first seen healthy does not.
 */
export class AlertService {
  private readonly lastStates = new Map<string, HealthState>();

  constructor(private readonly notify: (alert: Alert) => void) {}

  process(report: HealthReport): Alert[] {
    const alerts: Alert[] = [];
    for (const metric of report.metrics) {
      const previous = this.lastStates.get(metric.name) ?? null;
      this.lastStates.set(metric.name, metric.status);

      const changed = previous === null ? metric.status !== 'healthy' : previous !== metric.status;
      if (!changed) continue;

      alerts.push({
        metric: metric.name,
        previous,
        current: metric.status,
        value: metric.value,
        timestamp: report.timestamp,
        message: describe(metric.name, previous, metric.status, metric.value),
      });
    }
    alerts.forEach(this.notify);
    return alerts;
  }
}
