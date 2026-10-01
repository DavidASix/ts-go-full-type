export class UserVisibleError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "UserVisibleError";
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

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
