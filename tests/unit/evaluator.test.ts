import { describe, expect, it } from 'vitest';
import { EXIT_CODES, evaluate, overallStatus } from '../../src/health/evaluator.js';
import type { HealthState } from '../../src/types.js';

const thresholds = { warning: 80, critical: 90 };

describe('evaluate', () => {
  it.each([
    [0, 'healthy'],
    [79.99, 'healthy'],
    [80, 'warning'],
    [89.99, 'warning'],
    [90, 'critical'],
    [100, 'critical'],
  ] as const)('classifies %s%% as %s', (value, expected) => {
    expect(evaluate(value, thresholds)).toBe(expected);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -1, 100.01])('treats invalid value %s as unknown', (value) => {
    expect(evaluate(value, thresholds)).toBe('unknown');
  });
});

describe('overallStatus', () => {
  it.each<[HealthState[], HealthState]>([
    [['healthy', 'healthy'], 'healthy'],
    [['healthy', 'warning'], 'warning'],
    [['warning', 'unknown'], 'unknown'],
    [['unknown', 'critical', 'warning'], 'critical'],
    [[], 'unknown'],
  ])('reduces %j to %s', (states, expected) => {
    expect(overallStatus(states)).toBe(expected);
  });
});

describe('EXIT_CODES', () => {
  it('follows the Nagios plugin convention', () => {
    expect(EXIT_CODES).toEqual({ healthy: 0, warning: 1, critical: 2, unknown: 3 });
  });
});
