export class UserVisibleError extends Error {
  /**
   * Tag actionable errors so controllers can display them without a second error notification.
   * @param message Actionable failure text shown to the user.
   * @param options Error metadata or fixture configuration.
   */
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "UserVisibleError";
  }
}

/**
 * Normalize thrown values into text for reporting failures.
 * @param error Thrown value from resolution or transport work.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Recognize transport failures that may recover after a native reconnect.
 * @param error Thrown value from resolution or transport work.
 */
export function isLikelyConnectionError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return (
    message.includes("socket") ||
    message.includes("connection") ||
    message.includes("pipe") ||
    message.includes("econn") ||
    message.includes("broken") ||
    message.includes("closed") ||
    message.includes("disposed")
  );
}
