/** Local cancellation stops subsequent RPCs; it never aborts a native RPC in flight. */
export class RequestCancelledError extends Error {
  public constructor() { super("Type resolution was superseded."); this.name = "RequestCancelledError"; }
}

export function assertRequestActive(signal: AbortSignal): void {
  if (signal.aborted) throw new RequestCancelledError();
}

/** For shared connection waits only; RPC results with snapshot ownership must be drained. */
export function awaitWhileActive<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cancel = () => reject(new RequestCancelledError());
    signal.addEventListener("abort", cancel, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", cancel));
    if (signal.aborted) cancel();
  });
}

/**
 * Delay retry work while allowing cancellation to clear the pending timer.
 * @param milliseconds Retry delay before another resolution attempt.
 * @param signal Cancellation scope for the pending operation.
 */
export function waitForRetry(milliseconds: number, signal: AbortSignal): Promise<void> {
  assertRequestActive(signal);
  return new Promise((resolve, reject) => {
    /**
     * Stop the retry timer and reject the pending wait as cancelled.
     */
    const cancel = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      reject(new RequestCancelledError());
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", cancel, { once: true });
  });
}
