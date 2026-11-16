#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { main } from './app.js';
import { createNodeProbe } from './platform/nodeProbe.js';
import { sleep } from './util/async.js';

const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

function readVersion(): string {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
  return manifest.version;
}

// A closed pipe (e.g. `devops-sentinel | head -1`) is not an error worth a stack trace.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

process.exitCode = await main({
  argv: process.argv.slice(2),
  env: process.env,
  version: readVersion(),
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  stdoutIsTTY: process.stdout.isTTY === true,
  readFile: (path) => readFileSync(path, 'utf8'),
  probe: createNodeProbe(),
  sleep,
  now: () => new Date(),
  onShutdown: (handler) => {
    let received = 0;
    const listener = (signal: NodeJS.Signals) => {
      received += 1;
      // A second signal means the operator wants out now.
      if (received > 1) process.exit(128 + (signal === 'SIGINT' ? 2 : 15));
      handler();
    };
    SHUTDOWN_SIGNALS.forEach((signal) => process.on(signal, listener));
    return () => SHUTDOWN_SIGNALS.forEach((signal) => process.off(signal, listener));
  },
});
