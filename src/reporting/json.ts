import type { HealthReport } from '../types.js';

/**
 * Pretty-printed for single runs; one line per report (NDJSON) in continuous
 * mode so each cycle can be streamed into log tooling.
 */
export function renderJson(report: HealthReport, pretty: boolean): string {
  return JSON.stringify(report, null, pretty ? 2 : undefined);
}
