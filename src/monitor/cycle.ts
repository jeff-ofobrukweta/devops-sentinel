import type { Collector } from '../collectors/index.js';
import { evaluate, overallStatus } from '../health/evaluator.js';
import type { HealthReport, HostInfo, MetricKind, MetricResult, Thresholds } from '../types.js';
import { errorMessage, withTimeout } from '../util/async.js';

export interface CycleOptions {
  collectors: readonly Collector[];
  thresholds: Record<MetricKind, Thresholds>;
  timeoutMs: number;
  host: HostInfo;
  now: () => Date;
}

/**
 * Runs every collector concurrently, each with its own timeout. A failing or
 * hanging collector produces an "unknown" metric instead of failing the cycle.
 */
export async function runCycle(options: CycleOptions, signal?: AbortSignal): Promise<HealthReport> {
  const { collectors, thresholds, timeoutMs, host, now } = options;
  const outcomes = await Promise.allSettled(
    collectors.map((collector) =>
      withTimeout((childSignal) => collector.collect(childSignal), timeoutMs, collector.name, signal),
    ),
  );

  const metrics = collectors.map((collector, index): MetricResult => {
    const outcome = outcomes[index]!;
    const base = { kind: collector.kind, name: collector.name, unit: '%' as const, thresholds: thresholds[collector.kind] };
    if (outcome.status === 'rejected') {
      return { ...base, status: 'unknown', value: null, details: {}, error: errorMessage(outcome.reason) };
    }
    const { value, details } = outcome.value;
    return { ...base, status: evaluate(value, base.thresholds), value, details };
  });

  return {
    schemaVersion: 1,
    timestamp: now().toISOString(),
    host,
    overall: overallStatus(metrics.map((metric) => metric.status)),
    metrics,
  };
}
