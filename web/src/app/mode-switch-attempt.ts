/** One in-flight mode switch: created only when a switch is actually applied (not when auto is queued). */
let activeAttempt: AbortController | null = null;

export function beginModeSwitchAttempt(): AbortSignal {
  activeAttempt?.abort();
  activeAttempt = new AbortController();
  return activeAttempt.signal;
}

export function getActiveModeSwitchSignal(): AbortSignal | undefined {
  return activeAttempt?.signal;
}

export function abortActiveModeSwitchAttemptForTests(): void {
  activeAttempt?.abort();
  activeAttempt = null;
}

export function resetModeSwitchAttemptForTests(): void {
  abortActiveModeSwitchAttemptForTests();
}

export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}
