# Research notes

This file records what had to be learned before and during implementation, the sources consulted, and the experiments run.

Status labels:
- **Verified**: confirmed by an experiment on a real machine or container. The command and output are included.
- **Documented**: taken from the cited documentation and not independently tested.
- **Open**: not yet confirmed.

Experiment environment (13 November 2026): MacBook Pro, Apple Silicon (arm64, 8 cores, 16 GiB), macOS 15.3.1, Node.js 24.21.0, Docker Desktop with Engine 29.4.0 (cgroup v2), image `node:24.21.0-alpine`.

---

## 1. CPU utilisation and sampling

**Question:** how do you get a CPU percentage from Node, which has no "current CPU %" API?

- `os.cpus()` returns per-core cumulative times in ms (`user`, `nice`, `sys`, `idle`, `irq`) since boot. **Documented.**
- A single sample cannot give current utilisation. You need two samples and their difference: `busy = 1 − Δidle / Δtotal`. This is the same approach `top` uses with `/proc/stat` on Linux. **Documented.**
- Load average (`os.loadavg()`) is not utilisation. It counts runnable (and on Linux, uninterruptible) tasks, so it can exceed the core count. It is reported as context only. **Documented.**
- Edge cases handled in code and covered by unit tests:
  - Zero elapsed time (division by zero)
  - Counters going backwards
  - Core count changing between samples
- The default window is 1000 ms. Shorter windows react faster but give noisier readings.

Sources: Node.js `os.cpus()` and `os.loadavg()` docs (https://nodejs.org/api/os.html); `proc(5)` man page, `/proc/stat` section (https://man7.org/linux/man-pages/man5/proc.5.html).

## 2. Memory: Linux vs macOS

**Question:** does `os.freemem()` mean the same thing on every platform?

**No. Verified.**

**macOS:** `os.freemem()` reports only completely free pages. On the test Mac, the first native run reported **98.6% used**. `vm_stat` at the same time showed:

```
Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                3821.
Pages inactive:                          182155.
...
```

3,821 free pages is about 62 MB. macOS deliberately keeps little memory completely free and holds reclaimable data in inactive pages. Measured "used" figures at that moment:

| Definition | Used |
|---|---|
| `os.freemem()` (free pages only) | ~99% |
| free + inactive treated as available (psutil's macOS definition) | ~82–83% |
| `memory_pressure` "System-wide memory free percentage: 36%" | ~64% |

These are different definitions, and none is "the" answer.

**Decision:** on macOS, run `/usr/bin/vm_stat` and treat **free + inactive** pages as available. This follows psutil, a widely used monitoring library, so the definition can be explained and defended. The report labels the source (`"vm_stat"`), and the tool falls back to `os.freemem()` with source `"os"` if `vm_stat` fails. The parser is unit-tested against the real output captured above ([tests/fixtures/vm_stat-darwin-arm64.txt](tests/fixtures/vm_stat-darwin-arm64.txt)).

**Open:** this figure is not the same as Activity Monitor's "Memory Used" (app + wired + compressed), and it can differ by several percentage points.

**Linux:** `os.freemem()` returns `MemAvailable`, not `MemFree`. **Verified** inside a container (libuv 1.52.1):

```
MemTotal:        8024748 kB
MemFree:         6344336 kB
MemAvailable:    7380396 kB
os.freemem() →   7372588 kB   (matches MemAvailable; small drift from reading at different moments)
```

`MemAvailable` is the kernel's estimate of memory that can be allocated without swapping, which is the right basis for "used %". **Open:** older Node or libuv versions may return `MemFree`. The tool requires Node ≥ 24.

Sources: libuv `uv_get_free_memory` docs (https://docs.libuv.org/en/v1.x/misc.html); `proc(5)` man page, `/proc/meminfo` section; `man vm_stat`; psutil `virtual_memory()` docs (https://psutil.readthedocs.io/en/latest/#psutil.virtual_memory).

## 3. Disk usage

- `fs.statfs(path)` (Node ≥ 18.15) returns `bsize`, `blocks`, `bfree` and `bavail`. **Documented.**
- `bfree` includes blocks reserved for root, while `bavail` counts only what unprivileged users can use. Following `df`, utilisation is `used / (used + bavail)` where `used = blocks − bfree`. A disk therefore shows 100% when ordinary users can no longer write, even if root-reserved space remains. **Documented**, and unit-tested.
- **macOS APFS. Verified:** `statfs("/")` gave 80.4%, while `df /` showed 11%:

  ```
  Filesystem     1024-blocks      Used Available Capacity  Mounted on
  /dev/disk3s3s1   482797652  10894828  94696528    11%     /
  /dev/disk3s1     482797652 332761916  94696528    78%     /System/Volumes/Data
  ```

  `/` is the small sealed system volume, but all APFS volumes share the container's free space (`Available` is identical for both rows). The tool's figure, `(total − available) / total`, tracks how full the shared container is. That figure answers "will I run out of disk?", so it was kept. **Open:** exactly why `df`'s per-volume `Used` differs from `blocks − bfree` on APFS has not been investigated.

Sources: Node.js `fs.statfs` docs (https://nodejs.org/api/fs.html#fspromisesstatfspath-options); `statfs(2)` man page; GNU coreutils `df` invocation docs; Apple File System Guide.

## 4. Host vs container metrics

**Docker Desktop on macOS. Verified:** a container sees the Linux VM, not the Mac. With no limits, it reported 8 cores, **7.7 GiB** memory (the Mac has 16 GiB) and a 55 GiB root filesystem.

**Memory limits. Verified:**
- `os.totalmem()` inside a container ignores `--memory` and reports the VM or host total.
- Under cgroup v2, the limit is in `/sys/fs/cgroup/memory.max` (`max` means unlimited) and usage is in `memory.current`.
- The tool subtracts `inactive_file` from `memory.stat`, as `docker stats` does, so reclaimable page cache does not look like pressure.
- With `docker run --memory=256m`, the report showed `totalBytes: 268435456, source: "cgroup"`.

**CPU limits. Verified, then fixed:**
- `--cpus=0.5` is enforced as a CFS (Completely Fair Scheduler) quota: `/sys/fs/cgroup/cpu.max` read `50000 100000` (quota and period in µs, so 0.5 CPU).
- `os.cpus()` still lists all 8 cores. With one busy loop saturating the quota, the first version of the tool reported **5.63%** CPU, about 0.5 / 8 = 6.25%, instead of ~100% of the container's allowance.
- **Fix:** when a quota is set, the CPU collector reads `cpu.stat` `usage_usec` before and after the sampling window and divides it by `elapsed × quota CPUs`, using a monotonic clock (`process.hrtime.bigint()`). Without a quota (`cpu.max` = `max`), it keeps the `os.cpus()` calculation. This mirrors the memory rule: cgroup figures are used only when a limit exists.
- **Verified after the fix** (same machine, same image):

  | Container | Load | Reported CPU |
  |---|---|---|
  | `--cpus=0.5` | one busy loop | 97.95% (critical), `source: cgroup` |
  | `--cpus=2` | one busy loop | 50.08%, `source: cgroup` |
  | `--cpus=2` | idle | 0.22%, `source: cgroup` |
  | no quota | idle | 0.12%, `source: os` |

- The result is capped at 100%, because CFS accounting can briefly exceed the quota within a period. This is **Documented** in the kernel's CFS bandwidth docs; I did not observe it myself.
- **Open:** CPU pinning with `--cpuset-cpus` but no quota is not reflected. `os.cpus()` inside the container was not checked under pinning.

**Container detection** is a heuristic: `/.dockerenv` (Docker) or `/run/.containerenv` (Podman). cgroup CPU and memory are read only when one of these is present. **Open:**
- Other runtimes (e.g. containerd without Docker) are not detected.
- cgroup v1 hosts fall back to `os.*` figures, which was not tested.

Sources: Linux kernel "Control Group v2" (https://docs.kernel.org/admin-guide/cgroup-v2.html); Docker "Resource constraints" (https://docs.docker.com/engine/containers/resource_constraints/); Docker `stats` reference.

## 5. Docker image, non-root execution and signals

- **Non-root:** the official Node image provides a `node` user (uid 1000), and the Dockerfile sets `USER node`. **Verified:** `docker run --rm --entrypoint id devops-sentinel:local` → `uid=1000(node)`.
- **Ownership:** application files are copied without `--chown`, so they are root-owned and read-only to the app user.
- **Signals:**
  - **Documented:** with exec-form `ENTRYPOINT`, Node is PID 1. The kernel does not apply default signal actions to PID 1, so a PID-1 process that registers no handler would ignore `SIGTERM`. The app registers `SIGINT`/`SIGTERM` handlers, so shutdown works without an init process. Compose still sets `init: true` (tini) to reap zombie processes.
  - **Verified:** `docker compose stop` stopped the service in **0.20 s** with exit code 0, and the log ended with "Monitoring stopped". `docker stop` without init also exited 0.
- **Image size:** 166 MB, measured.
- **HEALTHCHECK:** `--once` exit codes 0 and 1 count as healthy. **Verified:** the Compose service reached `healthy`.

Sources: Dockerfile reference (`USER`, `ENTRYPOINT`, `HEALTHCHECK`): https://docs.docker.com/reference/dockerfile/; Docker build best practices; docker-node "Best Practices" (https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md); Compose specification (`init`, `read_only`, `cap_drop`); Node.js process signal events (https://nodejs.org/api/process.html#signal-events).

## 6. Graceful shutdown design

- An `AbortController` is aborted by the first `SIGINT` or `SIGTERM`. A second signal force-exits with 128 + signal number.
- The abort signal reaches:
  - the sleep between cycles, which resolves immediately
  - the CPU sampling window
  - every collector, through `withTimeout`
- A report finished after shutdown began is discarded rather than printed.
- **Verified:** an integration test sends `SIGTERM` to the real process and asserts exit 0 within 2 seconds.

## 7. GitHub Actions

- The matrix runs on `ubuntu-latest` and `macos-latest`, because memory collection differs per OS.
- `actions/setup-node` reads `.nvmrc` and caches npm. `npm ci` installs exactly what the lockfile specifies.
- `permissions: contents: read` gives least privilege. `concurrency` cancels superseded runs.
- The Docker job uses `docker/build-push-action` with `push: false`, `load: true` and the GitHub Actions cache.
- **Verified locally:** every command in the Docker job was run against a locally built image and passed.
- **Action versions. Verified 13 November 2026** against the GitHub releases API. Latest releases were `checkout` v7.0.1, `setup-node` v7.1.0, `setup-buildx-action` v4.4.1 and `build-push-action` v7.4.0, so the workflow was moved from the major versions first written (v5/v5/v3/v6). Breaking changes in the release notes:
  - `setup-node` v6 limits automatic caching to npm (this project uses npm).
  - The Docker actions removed deprecated inputs (none used here) and moved to a Node 24 runtime, which needs Actions Runner ≥ 2.327.1 (GitHub-hosted runners qualify).
  - None of these affect this workflow.
- **Open:** the workflow has not run on GitHub yet, because the repository has not been pushed.

Sources: GitHub Actions workflow syntax (https://docs.github.com/actions/reference/workflow-syntax-for-github-actions); `actions/setup-node` README; `docker/build-push-action` README; GitHub Actions cache backend docs (https://docs.docker.com/build/cache/backends/gha/).

## 8. Testing system-dependent code

- **Dependency injection** instead of module mocking: all OS access goes through the `SystemProbe` interface, so collectors and the full app can be run against controlled numbers. No test loads the real machine.
- **Fake timers:** Vitest fake timers drive the interval loop and the timeouts. The code uses `setTimeout` rather than `AbortSignal.timeout()` so fake timers can control it.
- **Scenario fixtures:** JSON files describe a machine state and the expected report and exit code.
- **Integration tests** run `dist/cli.js` as a child process on the real OS and check only shape and ranges, never exact values.
- **The tests found two defects:**
  1. `withTimeout` aborted the task before rejecting, so a task that rejects on abort won the race and hid the timeout. Fixed by rejecting first.
  2. A test fake that stopped advancing CPU counters exposed how `cpuUtilisation` behaves with zero elapsed time. The fake was corrected; the behaviour (reporting unknown) was already correct.

Sources: Vitest guide, Mocking and Fake Timers (https://vitest.dev/guide/mocking).

## 9. Conventions adopted

- **Exit codes:** Nagios Plugin Development Guidelines (0 OK, 1 WARNING, 2 CRITICAL, 3 UNKNOWN), plus 64 for usage errors (`EX_USAGE` from BSD `sysexits.h`).
- **`NO_COLOR`:** https://no-color.org.
- **Node LTS choice:** Node 20 reached end of life in April 2026. Node 24 ("Krypton") is the LTS used here. Release schedule: https://github.com/nodejs/release.
