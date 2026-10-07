/**
 * Narrow unknown boundary data to an object record, excluding null and arrays.
 * @param value Untrusted message, manifest, or JSON value.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
