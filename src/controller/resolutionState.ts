export interface AliasFocusCache {
  readonly uri: string;
  readonly version: number;
  readonly start: number;
  readonly end: number;
}

export class ResolutionGeneration {
  private value = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  public invalidate(): number {
    this.value += 1;
    this.cancelTimer();
    return this.value;
  }

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

  public cancelTimer(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}

export function isSameCachedAlias(
  cache: AliasFocusCache | undefined,
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
