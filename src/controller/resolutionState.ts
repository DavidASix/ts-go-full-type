export interface SymbolFocusCache {
  readonly uri: string;
  readonly version: number;
  readonly start: number;
  readonly end: number;
}

export class ResolutionGeneration {
  private value = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Advance the generation so earlier asynchronous work cannot publish.
   */
  public invalidate(): number {
    this.value += 1;
    this.cancelTimer();
    return this.value;
  }

  /**
   * Run one debounced callback with the captured generation and clear earlier timers.
   * @param delay Debounce interval in milliseconds.
   * @param callback Work invoked with the captured resolution generation.
   */
  public schedule(delay: number, callback: (generation: number) => void): void {
    this.cancelTimer();
    const scheduledGeneration = this.value;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      callback(scheduledGeneration);
    }, delay);
  }

  public current(): number {
    return this.value;
  }

  public isCurrent(generation: number): boolean {
    return generation === this.value;
  }

  /**
   * Clear the pending debounce callback without changing the generation.
   */
  public cancelTimer(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}

/**
 * Reuse a result only within the same document version and symbol range.
 * @param cache Previously resolved document version and identifier range.
 * @param uri Source or theme resource URI.
 * @param version Document version required for cache reuse.
 * @param offset Zero-based source offset within the selected identifier.
 */
export function isSameCachedSymbol(
  cache: SymbolFocusCache | undefined,
  uri: string,
  version: number,
  offset: number,
): boolean {
  return cache !== undefined &&
    cache.uri === uri &&
    cache.version === version &&
    offset >= cache.start &&
    offset < cache.end;
}
