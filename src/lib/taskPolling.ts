import { ApiError } from './api.ts';

export function startTaskPolling(
  load: (signal: AbortSignal) => Promise<boolean>,
  onError: (error: unknown, retrying: boolean) => void,
  initialDelay = 0,
): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout>;
  let pending: AbortController | undefined;
  let retryDelay = 1000;

  async function poll() {
    const request = new AbortController();
    pending = request;
    const timeout = setTimeout(() => request.abort(), 12_000);
    try {
      const active = await load(request.signal);
      if (request.signal.aborted) throw request.signal.reason;
      retryDelay = 1000;
      if (!stopped && active) timer = setTimeout(poll, 1000);
    } catch (error) {
      if (stopped) return;
      const retrying = error instanceof ApiError
        ? error.status >= 500 || error.status === 408 || error.status === 429
        : error instanceof TypeError || request.signal.aborted;
      onError(error, retrying);
      if (retrying) {
        timer = setTimeout(poll, retryDelay);
        retryDelay = Math.min(8000, retryDelay * 2);
      }
    } finally {
      clearTimeout(timeout);
      pending = undefined;
    }
  }

  timer = setTimeout(poll, initialDelay);
  return () => {
    stopped = true;
    clearTimeout(timer);
    pending?.abort();
  };
}
