const MORE_MARKER = /\.\.\.\s+\d+\s+more\s+\.\.\./;
const EMPTY_OBJECT_MARKER = /\{\s*\.\.\.\s*\}/;

export function hasPresentationTruncation(text: string): boolean {
  return MORE_MARKER.test(text) || EMPTY_OBJECT_MARKER.test(text);
}
