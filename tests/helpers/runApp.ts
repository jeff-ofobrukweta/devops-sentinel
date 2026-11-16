import { type AppDeps, main } from '../../src/app.js';
import { createFakeProbe, instantSleep } from './fakeProbe.js';

export interface AppRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Runs the application in-process with fake system access and captured output. */
export async function runApp(argv: string[], overrides: Partial<AppDeps> = {}): Promise<AppRun> {
  let stdout = '';
  let stderr = '';
  const exitCode = await main({
    argv,
    env: {},
    version: '9.9.9',
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    stdoutIsTTY: false,
    readFile: () => {
      throw new Error('ENOENT');
    },
    probe: createFakeProbe(),
    sleep: instantSleep,
    now: () => new Date('2026-01-01T00:00:00.000Z'),
    onShutdown: () => () => {},
    ...overrides,
  });
  return { exitCode, stdout, stderr };
}

export const logLines = (stderr: string) =>
  stderr
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { level: string; message: string; [key: string]: unknown });
