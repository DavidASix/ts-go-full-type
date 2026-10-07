/** Drain every RPC before propagating a failure, so its snapshot can be released safely. */
export async function settleQueries<T extends readonly unknown[]>(
  queries: { [K in keyof T]: Promise<T[K]> },
): Promise<T> {
  const results = await Promise.allSettled(queries);
  const failure = results.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  return results.map((result) => (result as PromiseFulfilledResult<unknown>).value) as unknown as T;
}
