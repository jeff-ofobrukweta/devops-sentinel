import { AlertService } from './alerts/service.js';
import { buildCollectors } from './collectors/index.js';
import { ConfigError } from './config/input.js';
import { type CliRequest, resolveCli } from './config/load.js';
import { EXIT_CODES, EXIT_USAGE_ERROR } from './health/evaluator.js';
import { createLogger, type Logger } from './logging/logger.js';
import { runCycle } from './monitor/cycle.js';
import { runMonitor } from './monitor/service.js';
import type { SystemProbe } from './platform/probe.js';
import { renderJson } from './reporting/json.js';
import { renderText } from './reporting/text.js';
import type { HealthReport, HealthState, SentinelConfig } from './types.js';
import { errorMessage, type Sleep } from './util/async.js';

export const HELP = `DevOps Sentinel: local CPU, memory and disk health monitoring.

Usage: devops-sentinel [options]

Modes:
      --once                 Run a single check and exit with a status code
                             (default: monitor continuously)
      --interval <seconds>   Seconds between checks in continuous mode (default 10)

Output:
  -f, --format <text|json>   Report format (default text)
      --no-color             Disable coloured text output
      --log-level <level>    debug | info | warn | error | silent (default info)

Collection:
      --disk-path <path>     Filesystem to check; repeat for several (default /)
      --sample-ms <ms>       CPU sampling window (default 1000)
      --timeout-ms <ms>      Per-collector timeout (default 5000)

Thresholds (percent):
      --cpu-warning <n>      --cpu-critical <n>      (default 75 / 90)
      --memory-warning <n>   --memory-critical <n>   (default 80 / 90)
      --disk-warning <n>     --disk-critical <n>     (default 80 / 90)

Other:
  -c, --config <file>        JSON config file (or SENTINEL_CONFIG)
      --print-config         Print the resolved configuration and exit
  -h, --help                 Show this help
  -v, --version              Show the version

Settings precedence: defaults < config file < SENTINEL_* environment variables < flags.

Exit codes (--once): 0 healthy, 1 warning, 2 critical, 3 unknown, 64 usage/config error.
`;

export interface AppDeps {
  argv: string[];
  env: Record<string, string | undefined>;
  version: string;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
  stdoutIsTTY: boolean;
  readFile: (path: string) => string;
  probe: SystemProbe;
  sleep: Sleep;
  now: () => Date;
  /** Registers a shutdown handler (SIGINT/SIGTERM) and returns a function that removes it. */
  onShutdown: (handler: () => void) => () => void;
}

const ALERT_LOG_LEVEL: Record<HealthState, keyof Logger> = {
  healthy: 'info',
  warning: 'warn',
  unknown: 'warn',
  critical: 'error',
};

export async function main(deps: AppDeps): Promise<number> {
  let request: CliRequest;
  try {
    request = resolveCli({ argv: deps.argv, env: deps.env, readFile: deps.readFile });
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    deps.stderr(`${error.message}\nRun with --help for usage.\n`);
    return EXIT_USAGE_ERROR;
  }

  if (request.kind === 'help') {
    deps.stdout(HELP);
    return 0;
  }
  if (request.kind === 'version') {
    deps.stdout(`${deps.version}\n`);
    return 0;
  }
  if (request.printConfig) {
    deps.stdout(`${JSON.stringify(request.config, null, 2)}\n`);
    return 0;
  }

  return run(request.config, deps);
}

async function run(config: SentinelConfig, deps: AppDeps): Promise<number> {
  const logger = createLogger(config.logLevel, deps.stderr, deps.now);
  const color = config.color === 'auto' ? deps.stdoutIsTTY : config.color;
  const render = (report: HealthReport) =>
    config.format === 'json' ? renderJson(report, config.once) : renderText(report, { color });

  const cycleOptions = {
    collectors: buildCollectors(config, deps.probe, deps.sleep),
    thresholds: config.thresholds,
    timeoutMs: config.collectorTimeoutMs,
    host: await deps.probe.hostInfo(),
    now: deps.now,
  };
  const host = cycleOptions.host;
  const check = (signal?: AbortSignal) => runCycle(cycleOptions, signal);
  const logFailures = (report: HealthReport) => {
    for (const metric of report.metrics) {
      if (metric.error) logger.debug('Metric collection failed', { metric: metric.name, error: metric.error });
    }
  };

  if (config.once) {
    const report = await check();
    logFailures(report);
    deps.stdout(`${render(report)}\n`);
    return EXIT_CODES[report.overall];
  }

  const controller = new AbortController();
  const removeShutdownHandler = deps.onShutdown(() => {
    logger.info('Shutdown requested, stopping monitor');
    controller.abort();
  });
  const alerts = new AlertService((alert) => logger[ALERT_LOG_LEVEL[alert.current]](alert.message, { alert }));

  logger.info('Monitoring started', {
    intervalSeconds: config.intervalSeconds,
    diskPaths: config.diskPaths,
    containerized: host.containerized,
  });

  const cycles = await runMonitor({
    intervalMs: config.intervalSeconds * 1000,
    signal: controller.signal,
    check,
    onReport: (report) => {
      logFailures(report);
      deps.stdout(`${render(report)}\n${config.format === 'text' ? '\n' : ''}`);
      alerts.process(report);
    },
    onError: (error) => logger.error('Monitoring cycle failed', { error: errorMessage(error) }),
    sleep: deps.sleep,
    now: () => deps.now().getTime(),
  });

  removeShutdownHandler();
  logger.info('Monitoring stopped', { cycles });
  return 0;
}
