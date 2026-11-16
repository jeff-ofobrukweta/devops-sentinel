export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

/** Resolves after `ms`, or immediately when `signal` aborts. Never rejects. */
export const sleep: Sleep = (ms, signal) =>
  new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener('abort', finish, { once: true });
  });

export class TimeoutError extends Error {
  override name = 'TimeoutError';
}

/**
 * Runs `task` with its own AbortSignal that fires when the parent aborts or
 * when `ms` elapses. Uses setTimeout rather than AbortSignal.timeout so that
 * test fake timers control it.
 */
export function withTimeout<T>(
  task: (signal: AbortSignal) => Promise<T>,
  ms: number,
  label: string,
  parent?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(parent?.reason);
  parent?.addEventListener('abort', onParentAbort, { once: true });

  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new TimeoutError(`${label} timed out after ${ms} ms`);
      // Reject before aborting: a task that rejects synchronously on abort
      // would otherwise win the race and hide the timeout as the cause.
      reject(error);
      controller.abort(error);
    }, ms);
  });

  return Promise.race([task(controller.signal), timeout]).finally(() => {
    clearTimeout(timer);
    parent?.removeEventListener('abort', onParentAbort);
  });
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
