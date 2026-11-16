# DevOps Sentinel

A lightweight command-line tool that checks CPU, memory and disk utilisation against configurable thresholds and reports **healthy**, **warning**, **critical** or **unknown**. It runs once (for scripts, cron and CI gates) or continuously (as a small monitoring daemon), natively on macOS/Linux or in Docker.

- No runtime dependencies: only Node.js built-ins (`os`, `fs.statfs`, `util.parseArgs`)
- Text output for people, JSON output for tools
- Nagios-style exit codes, so any script can act on the result
- Alerts on state *changes*, not on every check
- Container-aware CPU and memory reporting (cgroup v2 quotas and limits)

```
$ devops-sentinel --once
DevOps Sentinel  2026-11-13T20:51:57.975Z
Host: MacBookPro (darwin/arm64)  Container: no

METRIC  STATUS   VALUE  WARN  CRIT  DETAILS
cpu     HEALTHY  42.4%  75%   90%   8 cores, load 10.38 / 12.73 / 10.52
memory  WARNING  83.4%  80%   90%   13.3 GiB / 16.0 GiB (vm_stat)
disk:/  WARNING  80.4%  80%   90%   370.1 GiB used, 90.3 GiB free

Overall: WARNING
```

## Requirements

- Node.js 24 LTS (see `.nvmrc`; `nvm use` selects it)
- npm 10+
- Docker with Compose v2 (optional, for container use)
- macOS or Linux. Windows is not supported.

## Quick start

```bash
nvm use                 # Node 24
npm ci                  # install dev dependencies exactly as locked
npm run build           # compile TypeScript to dist/
node dist/cli.js --once # single check
node dist/cli.js        # continuous monitoring every 10 s; Ctrl-C to stop
```

`npm run check` runs type checking, all tests and the build in one go.

## Usage

```
devops-sentinel [options]

  --once                  Run one check and exit with a status code
  --interval <seconds>    Seconds between checks in continuous mode (default 10)
  -f, --format text|json  Report format (default text)
  --no-color              Disable coloured output (also: NO_COLOR=1)
  --log-level <level>     debug | info | warn | error | silent (default info)
  --disk-path <path>      Filesystem to check; repeatable (default /)
  --sample-ms <ms>        CPU sampling window (default 1000)
  --timeout-ms <ms>       Per-collector timeout (default 5000)
  --cpu-warning <n>       --cpu-critical <n>      (default 75 / 90)
  --memory-warning <n>    --memory-critical <n>   (default 80 / 90)
  --disk-warning <n>      --disk-critical <n>     (default 80 / 90)
  -c, --config <file>     JSON config file (also: SENTINEL_CONFIG)
  --print-config          Show the resolved configuration and exit
  -h, --help / -v, --version
```

### Exit codes (single run)

| Code | Meaning |
|---|---|
| 0 | Healthy |
| 1 | Warning |
| 2 | Critical |
| 3 | Unknown (at least one metric could not be read, and none is critical) |
| 64 | Invalid flags or configuration |

These follow the Nagios plugin convention, so the tool can be dropped into existing monitoring. In continuous mode the process exits 0 after a graceful shutdown.

```bash
# Fail a CI job or deployment script if the machine is critical
node dist/cli.js --once --log-level silent > /dev/null; [ $? -lt 2 ] || echo "host is critical"

# Pipe JSON into jq
node dist/cli.js --once --format json | jq '.metrics[] | {name, status, value}'
```

### Health rules

- A metric is **warning** when `value >= warning` and **critical** when `value >= critical`.
- A metric that cannot be collected (error or timeout) is **unknown**. The other metrics are still reported.
- The **overall** status is the most severe metric, ranked critical > unknown > warning > healthy. Critical outranks unknown because a confirmed problem is more actionable than a missing reading.

## Configuration

Settings are resolved in this order, with later sources winning:

**defaults → config file → environment variables → command-line flags**

Config file (see [config/sentinel.example.json](config/sentinel.example.json)):

```json
{
  "intervalSeconds": 10,
  "diskPaths": ["/"],
  "thresholds": { "cpu": { "warning": 75, "critical": 90 } }
}
```

Every setting is optional, and you can set only one threshold level. Unknown keys and wrong types are rejected with a message that names the setting.

| Setting | Environment variable | Flag | Rule |
|---|---|---|---|
| `once` | `SENTINEL_ONCE` | `--once` | boolean |
| `intervalSeconds` | `SENTINEL_INTERVAL_SECONDS` | `--interval` | 1–86400 |
| `cpuSampleMs` | `SENTINEL_CPU_SAMPLE_MS` | `--sample-ms` | whole number, 100–60000 |
| `collectorTimeoutMs` | `SENTINEL_COLLECTOR_TIMEOUT_MS` | `--timeout-ms` | > cpuSampleMs, ≤ 120000 |
| `format` | `SENTINEL_FORMAT` | `--format` | `text` or `json` |
| `logLevel` | `SENTINEL_LOG_LEVEL` | `--log-level` | debug/info/warn/error/silent |
| `diskPaths` | `SENTINEL_DISK_PATHS` (comma-separated) | `--disk-path` (repeat) | at least one |
| `color` | `NO_COLOR` (disables) | `--color` / `--no-color` | `"auto"` = only on a terminal |
| `thresholds.<metric>.<level>` | `SENTINEL_CPU_WARNING`, `SENTINEL_DISK_CRITICAL`, … | `--cpu-warning`, … | 0 ≤ warning < critical ≤ 100 |

## Output and logs

- **stdout** carries reports only. Text reports are tables. JSON reports are pretty-printed in `--once` mode and one line per cycle (NDJSON) in continuous mode.
- **stderr** carries structured JSON log lines: start and stop events, and alerts.

JSON report shape (`schemaVersion` increments on breaking changes):

```json
{
  "schemaVersion": 1,
  "timestamp": "2026-11-13T20:57:45.086Z",
  "host": { "hostname": "…", "platform": "linux", "arch": "arm64", "containerized": true },
  "overall": "critical",
  "metrics": [
    { "kind": "memory", "name": "memory", "status": "healthy", "value": 5.6, "unit": "%",
      "thresholds": { "warning": 80, "critical": 90 },
      "details": { "usedBytes": 15032320, "totalBytes": 268435456, "source": "cgroup" } },
    { "kind": "cpu", "name": "cpu", "status": "critical", "value": 97.95, "unit": "%",
      "thresholds": { "warning": 75, "critical": 90 },
      "details": { "cores": 8, "limitCpus": 0.5, "source": "cgroup", "sampleMs": 1000, "…": "…" } }
  ]
}
```

A failed metric has `"status": "unknown"`, `"value": null` and an `"error"` message.

### Alerts

In continuous mode, an alert is logged when a metric's state **changes**, including recovery:

```json
{"time":"…","level":"error","message":"memory changed: warning → critical (91.2%)","alert":{…}}
```

A metric that stays critical for an hour produces one alert, not 360. Alerts are log events. Forwarding them to Slack, email or a webhook is intentionally out of scope.

## Docker

```bash
docker compose up --build        # continuous monitoring, 256 MiB / 0.5 CPU limits
docker compose down              # graceful stop (SIGTERM → exit 0 in well under a second)

docker build -t devops-sentinel .
docker run --rm devops-sentinel --once --format json
docker run --rm --memory=256m devops-sentinel --once   # memory measured against the limit
```

How the image is built:

- **Multi-stage build.** TypeScript is compiled in a build stage, and only `dist/` and `package.json` reach the runtime image (about 166 MB, based on `node:24.21.0-alpine`).
- **Runs as the unprivileged `node` user** (uid 1000). Application files are owned by root, so the process cannot modify them.
- **Exec-form `ENTRYPOINT`.** Node receives `SIGTERM` directly. Compose adds `init: true` for zombie reaping, plus `read_only`, `cap_drop: [ALL]` and `no-new-privileges`.
- **`HEALTHCHECK` runs `--once`.** Healthy and warning count as healthy; critical, unknown or a crash count as unhealthy.

### What the container can and cannot see

Containers share the host kernel but are isolated by namespaces and limited by cgroups. That affects each metric differently:

| Metric | Inside a container | Notes |
|---|---|---|
| Memory | ✅ **Container's cgroup limit and usage** when a limit is set (`source: "cgroup"`). Otherwise the kernel's view (`source: "os"`). | Usage excludes reclaimable page cache, like `docker stats`. |
| CPU | ✅ **Share of the container's CPU quota** when `--cpus` is set (`source: "cgroup"`, measured from `cpu.stat` against `cpu.max`). Otherwise the whole kernel's CPU (`source: "os"`). | Verified: one busy loop under `--cpus=0.5` reports ~98%, and under `--cpus=2` reports ~50%. Before this was added, the same `--cpus=0.5` case reported 5.6%. `--cpuset-cpus` pinning without a quota is not accounted for. |
| Disk | ⚠️ **The container's own root filesystem** (overlay), not the host's disks | To monitor a host disk, bind-mount it: `-v /:/host:ro` then `--disk-path /host`. |

**On macOS (Docker Desktop)** the "host" is a Linux VM, not your Mac. A container sees the VM's cores, memory (e.g. 7.7 GiB on a 16 GiB Mac) and disk. To monitor the Mac itself, run the tool natively.

## Platform notes

- **macOS memory** comes from `vm_stat` as free + inactive pages (the same definition psutil uses). `os.freemem()` on macOS counts only completely free pages and reported ~99% used on a normal machine. If `vm_stat` fails, the tool falls back to `os.freemem()` and labels the source `"os"`.
- **macOS disk (`/`)**: on APFS, the volumes in a container share free space. The figure reflects how full the whole APFS container is, which is usually what you want. It differs from `df /`, which reports only the small sealed system volume.
- **Linux memory** uses `os.freemem()`, which returns `MemAvailable` (verified with libuv 1.52.1).
- **CPU** is measured as `1 − Δidle / Δtotal` across all cores over `--sample-ms`. A longer window is smoother, and a shorter one reacts faster but is noisier.

See [RESEARCH.md](RESEARCH.md) for sources and the experiments behind these notes.

## Development

```bash
npm run typecheck      # tsc --noEmit over src and tests
npm test               # unit + scenario + integration tests (builds dist/ first)
npm run test:coverage  # with coverage thresholds (80% lines)
npm run test:watch
```

Tests never load the real machine. All system access goes through the `SystemProbe` interface ([src/platform/probe.ts](src/platform/probe.ts)), which tests replace with controlled data. Sample scenarios live in [tests/fixtures/scenarios/](tests/fixtures/scenarios/) as JSON files; add a file to add a scenario. Integration tests run the compiled CLI against the real OS and check only the output's shape and ranges.

### Project layout

```
src/
  cli.ts              process wiring: argv, signals, stdout/stderr, exit code
  app.ts              main(): resolves config, runs once or continuously
  types.ts            shared domain types
  config/             defaults, file/env/flag sources, merging, validation
  platform/           SystemProbe interface + Node implementation, cgroup and vm_stat parsing
  collectors/         CPU, memory and disk collectors
  health/evaluator.ts thresholds → state, overall status, exit codes
  monitor/            one check cycle (with timeouts) and the interval loop
  alerts/service.ts   state-change alerting
  reporting/          text and JSON renderers
  logging/logger.ts   JSON-lines logger to stderr
tests/
  unit/               one file per area, using the fake probe
  scenarios.test.ts   runs every fixture in tests/fixtures/scenarios
  integration/        runs dist/cli.js as a real process
```

### Dependencies

Runtime: **none**.

Development:

| Package | Why |
|---|---|
| `typescript` | Type checking and compilation |
| `vitest` | Test runner with fake timers and mocking |
| `@vitest/coverage-v8` | Coverage thresholds in CI |
| `@types/node` | Types for Node built-ins |

## CI

[.github/workflows/ci.yml](.github/workflows/ci.yml) runs on every push to `main` and on every pull request:

1. **Test job** on Ubuntu and macOS: `npm ci` → typecheck → tests with coverage thresholds → build → smoke test the CLI → `npm audit` (advisory).
2. **Docker job** (after tests pass):
   - Build the image with layer caching.
   - Check that the container's JSON report is valid.
   - Check that it runs as non-root.
   - Check that cgroup memory is reported under `--memory=256m`.
   - Check that cgroup CPU is reported under `--cpus=0.5`.
   - Check that it stops gracefully on `SIGTERM`.

Nothing is deployed. There is no target environment, so this is deliberate.

## Scope

**In scope:** local CPU, memory and disk checks; thresholds; four health states; text and JSON reports; single-run and continuous modes; state-change alerts; Docker; CI.

**Out of scope:**
- Cloud or Kubernetes deployment
- Dashboards
- Storing metric history
- Remote hosts
- Alert delivery channels
- Network, GPU or per-process metrics
- Windows

**Possible next steps:**
- Alert hysteresis (N consecutive breaches before alerting)
- Webhook alert sink
- Publishing the image to GHCR
