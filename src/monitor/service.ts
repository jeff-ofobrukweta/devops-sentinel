import type { HealthReport } from '../types.js';
import type { Sleep } from '../util/async.js';

export interface MonitorOptions {
  intervalMs: number;
  signal: AbortSignal;
  check: (signal: AbortSignal) => Promise<HealthReport>;
  onReport: (report: HealthReport) => void;
  onError: (error: unknown) => void;
  sleep: Sleep;
  now: () => number;
}

/**
 * Runs checks until `signal` aborts. Cycles never overlap: the next check is
 * scheduled `intervalMs` after the previous one started, or immediately if the
 * check itself took longer than the interval. Returns the number of completed cycles.
 */
export async function runMonitor(options: MonitorOptions): Promise<number> {
  const { intervalMs, signal, check, onReport, onError, sleep, now } = options;
  let cycles = 0;

  while (!signal.aborted) {
    const startedAt = now();
    try {
      const report = await check(signal);
      if (signal.aborted) break;
      onReport(report);
    } catch (error) {
      if (signal.aborted) break;
      onError(error);
    }
    cycles += 1;
    await sleep(Math.max(0, intervalMs - (now() - startedAt)), signal);
  }

  return cycles;
}
