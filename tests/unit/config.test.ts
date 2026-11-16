import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../../src/config/defaults.js';
import { ConfigError, mergeInputs } from '../../src/config/input.js';
import { resolveCli } from '../../src/config/load.js';
import { configFromArgs, configFromEnv, configFromFile } from '../../src/config/sources.js';
import { validateConfig } from '../../src/config/validate.js';

const issuesOf = (fn: () => unknown): string[] => {
  try {
    fn();
  } catch (error) {
    if (error instanceof ConfigError) return error.issues;
    throw error;
  }
  throw new Error('expected a ConfigError');
};

describe('validateConfig', () => {
  it('returns the defaults for empty input', () => {
    expect(validateConfig({})).toEqual(DEFAULT_CONFIG);
  });

  it('reports every problem at once', () => {
    const issues = issuesOf(() =>
      validateConfig({ intervalSeconds: 0, format: 'xml', logLevel: 'loud', diskPaths: [] }),
    );
    expect(issues).toHaveLength(4);
  });

  it.each([
    [{ warning: 90, critical: 90 }, 'equal'],
    [{ warning: 95, critical: 90 }, 'inverted'],
    [{ warning: -1, critical: 50 }, 'negative'],
    [{ warning: 50, critical: 101 }, 'over 100'],
  ])('rejects %j thresholds (%s)', (cpu) => {
    expect(issuesOf(() => validateConfig({ thresholds: { cpu } }))[0]).toMatch(/cpu thresholds/);
  });

  it('requires the collector timeout to exceed the CPU sampling window', () => {
    expect(issuesOf(() => validateConfig({ cpuSampleMs: 2000, collectorTimeoutMs: 2000 }))[0]).toMatch(
      /collectorTimeoutMs/,
    );
  });

  it('rejects a fractional CPU sample window', () => {
    expect(issuesOf(() => validateConfig({ cpuSampleMs: 250.5 }))[0]).toMatch(/cpuSampleMs/);
  });

  it('removes duplicate disk paths', () => {
    expect(validateConfig({ diskPaths: ['/', '/', '/data'] }).diskPaths).toEqual(['/', '/data']);
  });

  it('merges a single threshold level onto the default for that metric', () => {
    expect(validateConfig({ thresholds: { disk: { warning: 60 } } }).thresholds.disk).toEqual({
      warning: 60,
      critical: 90,
    });
  });
});

describe('mergeInputs', () => {
  it('lets later layers win and merges thresholds per level', () => {
    const merged = mergeInputs(
      { intervalSeconds: 5, thresholds: { cpu: { warning: 50, critical: 60 } } },
      { intervalSeconds: 30, thresholds: { cpu: { critical: 70 } } },
    );
    expect(merged).toEqual({ intervalSeconds: 30, thresholds: { cpu: { warning: 50, critical: 70 } } });
  });
});

describe('configFromFile', () => {
  it('reads a valid file', () => {
    const input = configFromFile(
      JSON.stringify({ intervalSeconds: 30, diskPaths: ['/'], color: 'auto', thresholds: { memory: { warning: 70 } } }),
      'test.json',
    );
    expect(input).toEqual({ intervalSeconds: 30, diskPaths: ['/'], color: 'auto', thresholds: { memory: { warning: 70 } } });
  });

  it('rejects malformed JSON', () => {
    expect(issuesOf(() => configFromFile('{', 'bad.json'))[0]).toMatch(/bad\.json: invalid JSON/);
  });

  it('rejects a non-object document', () => {
    expect(issuesOf(() => configFromFile('[1]', 'list.json'))[0]).toMatch(/must be a JSON object/);
  });

  it('rejects unknown keys and wrong types, naming each one', () => {
    const issues = issuesOf(() =>
      configFromFile(
        JSON.stringify({
          intervalSecs: 5,
          once: 'yes',
          format: 1,
          color: 'sometimes',
          diskPaths: '/',
          cpuSampleMs: '1000',
          thresholds: { gpu: {}, cpu: { warn: 1, critical: 'high' }, disk: 5 },
        }),
        'f.json',
      ),
    );
    expect(issues).toEqual([
      'f.json: unknown setting "intervalSecs"',
      'f.json: once must be a boolean',
      'f.json: format must be a string',
      'f.json: color must be true, false or "auto"',
      'f.json: diskPaths must be an array of strings',
      'f.json: cpuSampleMs must be a number',
      'f.json: thresholds.gpu is not a known metric (expected cpu, memory, disk)',
      'f.json: thresholds.cpu.warn is not a known level',
      'f.json: thresholds.cpu.critical must be a number',
      'f.json: thresholds.disk must be an object',
    ]);
  });

  it('rejects thresholds that are not an object', () => {
    expect(issuesOf(() => configFromFile('{"thresholds": 1}', 'f.json'))).toEqual(['f.json: thresholds must be an object']);
  });
});

describe('configFromEnv', () => {
  it('reads SENTINEL_* variables and ignores empty ones', () => {
    const input = configFromEnv({
      SENTINEL_INTERVAL_SECONDS: '15',
      SENTINEL_CPU_SAMPLE_MS: '500',
      SENTINEL_MEMORY_CRITICAL: '95',
      SENTINEL_ONCE: 'yes',
      SENTINEL_FORMAT: 'json',
      SENTINEL_LOG_LEVEL: 'warn',
      SENTINEL_DISK_PATHS: '/, /data ,',
      SENTINEL_COLLECTOR_TIMEOUT_MS: '',
      NO_COLOR: '1',
    });
    expect(input).toEqual({
      intervalSeconds: 15,
      cpuSampleMs: 500,
      thresholds: { memory: { critical: 95 } },
      once: true,
      format: 'json',
      logLevel: 'warn',
      diskPaths: ['/', '/data'],
      color: false,
    });
  });

  it('names the variable that failed to parse', () => {
    expect(issuesOf(() => configFromEnv({ SENTINEL_CPU_WARNING: 'high', SENTINEL_ONCE: 'maybe' }))).toEqual([
      'SENTINEL_CPU_WARNING must be a number (got "high")',
      'SENTINEL_ONCE must be true or false (got "maybe")',
    ]);
  });

  it('accepts false-like values for SENTINEL_ONCE', () => {
    expect(configFromEnv({ SENTINEL_ONCE: 'false' })).toEqual({ once: false });
  });
});

describe('configFromArgs', () => {
  it('parses every option', () => {
    const parsed = configFromArgs([
      '--once',
      '--interval', '5',
      '--sample-ms', '200',
      '--timeout-ms', '900',
      '-f', 'json',
      '-c', 'cfg.json',
      '--disk-path', '/',
      '--disk-path', '/data',
      '--log-level', 'debug',
      '--no-color',
      '--disk-warning', '70',
      '--print-config',
    ]);
    expect(parsed).toEqual({
      input: {
        once: true,
        intervalSeconds: 5,
        cpuSampleMs: 200,
        collectorTimeoutMs: 900,
        format: 'json',
        logLevel: 'debug',
        color: false,
        diskPaths: ['/', '/data'],
        thresholds: { disk: { warning: 70 } },
      },
      configPath: 'cfg.json',
      help: false,
      version: false,
      printConfig: true,
    });
  });

  it('rejects unknown flags and positional arguments', () => {
    expect(issuesOf(() => configFromArgs(['--bogus']))[0]).toMatch(/bogus/);
    expect(issuesOf(() => configFromArgs(['extra']))[0]).toMatch(/extra/);
  });

  it('rejects non-numeric values', () => {
    expect(issuesOf(() => configFromArgs(['--interval', 'soon']))).toEqual(['--interval must be a number (got "soon")']);
  });
});

describe('resolveCli', () => {
  const files: Record<string, string> = { 'cfg.json': '{"intervalSeconds": 20, "thresholds": {"cpu": {"warning": 60}}}' };
  const readFile = (path: string) => {
    const content = files[path];
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return content;
  };

  it('applies defaults < file < environment < flags', () => {
    const request = resolveCli({
      argv: ['--config', 'cfg.json', '--cpu-critical', '99'],
      env: { SENTINEL_INTERVAL_SECONDS: '25', SENTINEL_CPU_CRITICAL: '80' },
      readFile,
    });
    if (request.kind !== 'run') throw new Error('expected run');
    expect(request.config.intervalSeconds).toBe(25);
    expect(request.config.thresholds.cpu).toEqual({ warning: 60, critical: 99 });
  });

  it('reads the config path from SENTINEL_CONFIG', () => {
    const request = resolveCli({ argv: [], env: { SENTINEL_CONFIG: 'cfg.json' }, readFile });
    expect(request.kind === 'run' && request.config.intervalSeconds).toBe(20);
  });

  it('reports an unreadable config file', () => {
    expect(issuesOf(() => resolveCli({ argv: ['-c', 'missing.json'], env: {}, readFile }))[0]).toMatch(
      /cannot read config file missing\.json/,
    );
  });

  it('short-circuits help and version before validating anything else', () => {
    expect(resolveCli({ argv: ['--help', '--interval', '0'], env: {}, readFile })).toEqual({ kind: 'help' });
    expect(resolveCli({ argv: ['-v'], env: {}, readFile })).toEqual({ kind: 'version' });
  });
});
