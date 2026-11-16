import type { LogLevel } from '../types.js';

type Fields = Record<string, unknown>;
type EmittingLevel = Exclude<LogLevel, 'silent'>;

export type Logger = Record<EmittingLevel, (message: string, fields?: Fields) => void>;

const SEVERITY: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

/**
 * Writes one JSON object per line. Intended for stderr so that stdout carries
 * only reports and can be piped to tools such as jq.
 */
export function createLogger(level: LogLevel, write: (line: string) => void, now: () => Date = () => new Date()): Logger {
  const emit = (entryLevel: EmittingLevel) => (message: string, fields: Fields = {}) => {
    if (SEVERITY[entryLevel] < SEVERITY[level]) return;
    write(`${JSON.stringify({ time: now().toISOString(), level: entryLevel, message, ...fields })}\n`);
  };
  return { debug: emit('debug'), info: emit('info'), warn: emit('warn'), error: emit('error') };
}
