# Use of AI in this project

This project was built with an AI coding assistant (Claude, via Claude Code in VS Code). This file describes how it was used, so that reviewers can judge the work fairly.

## How the work was split

**1. Planning (human-led, AI-assisted).** I wrote a detailed brief covering scope, constraints (local only, no cloud), required tooling, and the planning artefacts I expected. I told the assistant to plan only and not write code. It produced a plan covering requirements, architecture, research topics, Docker, testing, CI, a phased roadmap, risks and a definition of done. I reviewed the plan and approved it before implementation started.

**2. Implementation (AI-generated, human-reviewed).** After approval, the assistant generated the source code, tests, Dockerfile, Compose file, CI workflow and first drafts of this documentation. It ran the type checker, test suite, Docker builds and container experiments on my machine, and fixed the problems those runs exposed.

**3. Decisions the assistant made with defaults, which I can revisit:**
- Node 24 LTS (Node 20, installed at the start, is end-of-life)
- A Docker `HEALTHCHECK` that treats warning as healthy
- No ESLint (strict TypeScript only)
- cgroup-aware container memory included in the MVP

## Where the AI's first output was wrong or incomplete

These were caught by running the code, not by trusting it:

- **macOS memory.** The initial implementation used `os.freemem()` as planned. The first real run reported 98.6% memory used. Comparing against `vm_stat` showed that `os.freemem()` counts only completely free pages on macOS. A `vm_stat`-based collector was added (see RESEARCH.md §2).
- **Timeout race.** A unit test revealed that `withTimeout` reported "collector saw abort" instead of "timed out", because it aborted before rejecting. Fixed and covered by a test.
- **Container CPU.** The first version reported 5.6% CPU for a container saturating its 0.5-CPU quota, because `os.cpus()` ignores quotas. The plan had listed this as a known limitation. After the MVP, cgroup-quota-aware CPU was added and verified at ~98% in the same experiment (RESEARCH.md §4).
- **Outdated CI action versions.** The workflow was first written with action versions one major release behind. They were checked against the GitHub releases API and updated after reviewing the breaking changes.
- **Container memory display.** Running in Docker showed "0.0 GiB / 0.3 GiB" for a 256 MiB limit. Byte formatting now switches to MiB below 1 GiB.
- **A TypeScript type error** in the argument-parser options was caught by `tsc` and fixed.

## How claims were checked

- RESEARCH.md separates **Verified** findings (with the command and output) from **Documented** facts taken from sources and **Open** questions. The assistant was told not to present unrun experiments as findings.
- All metric behaviour in Docker (cgroup memory, the CPU quota limitation, non-root user, graceful stop, health status) was observed on a real container, not assumed.

## My own review

<!-- Complete this before submitting: it is the part assessors most want to see. -->

- [ ] I can explain the CPU two-sample calculation and why a single sample is meaningless.
- [ ] I can explain why container metrics differ from host metrics, and which metrics are cgroup-aware.
- [ ] I can explain each CI step and what failure it catches.
- [ ] I read every source file and test, and noted anything I would change:
  - …
- [ ] Changes I made myself after review:
  - …
