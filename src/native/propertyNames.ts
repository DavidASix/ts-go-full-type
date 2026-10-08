/** Use the same identifier or quoted property label for semantic symbols and compiler syntax. */
export function quotePropertyName(name: string): string {
  return /^[$A-Z_a-z][$\w]*$/u.test(name) ? name : JSON.stringify(name);
}
