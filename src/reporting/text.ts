import type { HealthReport, HealthState, MetricResult } from '../types.js';

const ANSI: Record<HealthState, string> = {
  healthy: '\u001b[32m',
  warning: '\u001b[33m',
  critical: '\u001b[31m',
  unknown: '\u001b[35m',
};
const RESET = '\u001b[0m';
const MIB = 1024 ** 2;
const GIB = 1024 ** 3;

/** GiB for large values; MiB below 1 GiB so small container limits stay readable. */
export function formatBytes(bytes: number): string {
  return bytes >= GIB ? `${(bytes / GIB).toFixed(1)} GiB` : `${Math.round(bytes / MIB)} MiB`;
}

function describe(metric: MetricResult): string {
  if (metric.error) return metric.error;
  const d = metric.details;
  switch (metric.kind) {
    case 'cpu': {
      const capacity = d.source === 'cgroup' ? `of ${d.limitCpus} CPU quota` : `${d.cores} cores`;
      return `${capacity}, load ${d.loadAverage1m} / ${d.loadAverage5m} / ${d.loadAverage15m}`;
    }
    case 'memory':
      return `${formatBytes(Number(d.usedBytes))} / ${formatBytes(Number(d.totalBytes))} (${d.source})`;
    case 'disk':
      return `${formatBytes(Number(d.usedBytes))} used, ${formatBytes(Number(d.availableBytes))} free`;
  }
}

export function renderText(report: HealthReport, options: { color: boolean }): string {
  const paint = (state: HealthState, text: string) => (options.color ? `${ANSI[state]}${text}${RESET}` : text);

  const header = ['METRIC', 'STATUS', 'VALUE', 'WARN', 'CRIT', 'DETAILS'];
  const rows = report.metrics.map((metric) => [
    metric.name,
    metric.status.toUpperCase(),
    metric.value === null ? '-' : `${metric.value.toFixed(1)}%`,
    `${metric.thresholds.warning}%`,
    `${metric.thresholds.critical}%`,
    describe(metric),
  ]);

  const widths = header.map((title, column) => Math.max(title.length, ...rows.map((row) => row[column]!.length)));
  const line = (cells: string[], state?: HealthState) =>
    cells
      .map((cell, column) => {
        const padded = column === cells.length - 1 ? cell : cell.padEnd(widths[column]!);
        return column === 1 && state ? paint(state, padded) : padded;
      })
      .join('  ')
      .trimEnd();

  const { host } = report;
  return [
    `DevOps Sentinel  ${report.timestamp}`,
    `Host: ${host.hostname} (${host.platform}/${host.arch})  Container: ${host.containerized ? 'yes' : 'no'}`,
    '',
    line(header),
    ...rows.map((row, index) => line(row, report.metrics[index]!.status)),
    '',
    `Overall: ${paint(report.overall, report.overall.toUpperCase())}`,
  ].join('\n');
}
