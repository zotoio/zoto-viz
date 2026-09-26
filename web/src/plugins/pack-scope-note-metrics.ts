/** Test-only counters for pack scope note refresh (reset in vitest beforeEach). */
let recounts = 0;
let textWrites = 0;

export function resetPackScopeNoteMetrics(): void {
  recounts = 0;
  textWrites = 0;
}

export function readPackScopeNoteMetrics(): { recounts: number; textWrites: number } {
  return { recounts, textWrites };
}

export function recordPackScopeNoteRecount(): void {
  recounts += 1;
}

export function recordPackScopeNoteTextWrite(): void {
  textWrites += 1;
}
