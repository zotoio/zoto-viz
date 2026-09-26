/** One in-flight mode switch: created only when a switch is actually applied (not when auto is queued). */
let activeAttempt: AbortController | null = null;

type AbortListenerEntry = {
  listener: EventListener;
  options?: boolean | AddEventListenerOptions;
};

const abortListenersBySignal = new WeakMap<AbortSignal, AbortListenerEntry[]>();

/** Abort cleanup tied to this attempt; detached on {@link commitModeSwitchAttempt} without firing abort. */
export function addModeSwitchAbortListener(
  signal: AbortSignal | undefined,
  listener: () => void,
  options?: boolean | AddEventListenerOptions,
): void {
  if (!signal) return;
  signal.addEventListener("abort", listener, options);
  const list = abortListenersBySignal.get(signal) ?? [];
  list.push({ listener, options });
  abortListenersBySignal.set(signal, list);
}

export function detachModeSwitchAbortListeners(signal: AbortSignal): void {
  const list = abortListenersBySignal.get(signal);
  if (!list) return;
  for (const { listener, options } of list) {
    signal.removeEventListener("abort", listener, options);
  }
  abortListenersBySignal.delete(signal);
}

export function modeSwitchAbortListenerCountForTests(signal: AbortSignal): number {
  return abortListenersBySignal.get(signal)?.length ?? 0;
}

export function beginModeSwitchAttempt(): AbortSignal {
  activeAttempt?.abort();
  activeAttempt = new AbortController();
  return activeAttempt.signal;
}

export function getActiveModeSwitchSignal(): AbortSignal | undefined {
  return activeAttempt?.signal;
}

/**
 * Successful mode switch (consent + load): drop the attempt controller without aborting and
 * detach dispose listeners so a later switch does not double-dispose committed resources.
 */
export function commitModeSwitchAttempt(signal?: AbortSignal): void {
  const ac = activeAttempt;
  if (!ac) return;
  if (signal && ac.signal !== signal) return;
  detachModeSwitchAbortListeners(ac.signal);
  activeAttempt = null;
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
