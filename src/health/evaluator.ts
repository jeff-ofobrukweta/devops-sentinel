import type { HealthState, Thresholds } from '../types.js';

/**
 * Classifies a utilisation percentage. A value counts as breaching a threshold
 * when it is greater than or equal to it. Values that are not a valid
 * percentage are "unknown" because they indicate a collection bug, not health.
 */
export function evaluate(value: number, thresholds: Thresholds): HealthState {
  if (!Number.isFinite(value) || value < 0 || value > 100) return 'unknown';
  if (value >= thresholds.critical) return 'critical';
  if (value >= thresholds.warning) return 'warning';
  return 'healthy';
}

// Critical outranks unknown: a confirmed critical problem is more actionable
// than a metric we could not read. Unknown outranks warning because we cannot
// claim the system is merely degraded when part of it is unobservable.
const PRECEDENCE: Record<HealthState, number> = {
  healthy: 0,
  warning: 1,
  unknown: 2,
  critical: 3,
};

export function overallStatus(states: readonly HealthState[]): HealthState {
  if (states.length === 0) return 'unknown';
  return states.reduce((worst, state) => (PRECEDENCE[state] > PRECEDENCE[worst] ? state : worst));
}

/** Nagios plugin convention: 0 OK, 1 WARNING, 2 CRITICAL, 3 UNKNOWN. */
export const EXIT_CODES: Record<HealthState, number> = {
  healthy: 0,
  warning: 1,
  critical: 2,
  unknown: 3,
};

export const EXIT_USAGE_ERROR = 64;
