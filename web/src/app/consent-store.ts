/**
 * One consent store keyed by pack id. Spec objects are copied on every read, so consent never lives
 * on them: the pane loader, the main load, the picker and the dice all ask this store, and pane
 * notices update when a pack's entry changes. Kept free of plugin imports (media/camera read it).
 *
 * - A catalog seed never downgrades a grant made here for the same pack content (a refresh requested
 *   before the grant but delivered after it must not bring the notice back).
 * - One in-flight request per pack: a second pane waits on the first request instead of starting one.
 * - A failed request is dropped, its error is shown to every waiter, and the next attempt starts fresh.
 */

export type ConsentState = "none" | "granted" | "changed" | "stale";
export type ConsentKind = "reviewed" | "authored";
export type ConsentOutcome = "ok" | "declined" | "failed" | "aborted";

/** What a request runner resolves to: the granted kind, or the operator said no. Throw on failure. */
export type ConsentRunner = (signal: AbortSignal) => Promise<ConsentKind | "declined">;

export type ConsentSeed = {
  id: string;
  consent?: ConsentKind | null;
  consent_state?: ConsentState;
  version?: string | number;
  hash?: string;
  shader_sha256?: string;
  assets_sha256?: string;
  backend_sha256?: string;
  collector_sha256?: string;
};

type Entry = {
  state: ConsentState;
  kind: ConsentKind | null;
  identity: string;
  /** Granted in this session through `request`, not just reported by the catalog. */
  local: boolean;
  error: string | null;
};

type Pending = {
  promise: Promise<ConsentOutcome>;
  controller: AbortController;
  waiters: number;
};

const entries = new Map<string, Entry>();
const pending = new Map<string, Pending>();
const listeners = new Set<(packId: string) => void>();

const STATES: readonly ConsentState[] = ["none", "granted", "changed", "stale"];

/** Content identity: a grant only survives catalog refreshes that describe the same pack content. */
export function consentIdentity(seed: ConsentSeed): string {
  return [
    seed.version ?? "",
    seed.hash ?? "",
    seed.shader_sha256 ?? "",
    seed.assets_sha256 ?? "",
    seed.backend_sha256 ?? "",
    seed.collector_sha256 ?? "",
  ].join("|");
}

function stateFromSeed(seed: ConsentSeed): ConsentState {
  if (seed.consent_state && STATES.includes(seed.consent_state)) return seed.consent_state;
  return seed.consent === "reviewed" || seed.consent === "authored" ? "granted" : "none";
}

function notify(packId: string): void {
  for (const fn of [...listeners]) {
    try {
      fn(packId);
    } catch (e) {
      console.warn("zoto-viz consent listener:", e);
    }
  }
}

/** Record what the catalog says about a pack. Never downgrades a same-content local grant. */
export function seedConsent(seed: ConsentSeed): void {
  if (!seed.id) return;
  const identity = consentIdentity(seed);
  const state = stateFromSeed(seed);
  const prev = entries.get(seed.id);
  if (prev?.local && prev.state === "granted" && prev.identity === identity && state !== "granted") return;
  const kind = state === "granted" ? (seed.consent ?? prev?.kind ?? null) : null;
  const next: Entry = { state, kind, identity, local: state === "granted" && !!prev?.local && prev.identity === identity, error: null };
  if (prev && prev.state === next.state && prev.kind === next.kind && prev.identity === next.identity && !prev.error) {
    entries.set(seed.id, { ...next, local: prev.local });
    return;
  }
  entries.set(seed.id, next);
  notify(seed.id);
}

export function seedConsentFromCatalog(rows: readonly ConsentSeed[]): void {
  for (const row of rows) seedConsent(row);
}

/** The store's view of a pack, seeding from the spec the first time it is asked about. */
export function consentStateOf(seed: ConsentSeed): ConsentState {
  if (!entries.has(seed.id)) seedConsent(seed);
  return entries.get(seed.id)?.state ?? "none";
}

export function consentGranted(seed: ConsentSeed): boolean {
  return consentStateOf(seed) === "granted";
}

export function consentKindOf(packId: string): ConsentKind | null {
  return entries.get(packId)?.kind ?? null;
}

/** Last failed request for this pack (cleared by the next attempt or a grant). */
export function consentErrorOf(packId: string): string | null {
  return entries.get(packId)?.error ?? null;
}

export function isConsentRequestPending(packId?: string | null): boolean {
  if (packId) return pending.has(packId);
  return pending.size > 0;
}

export function onConsentChange(fn: (packId: string) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function settleEntry(packId: string, patch: Partial<Entry>): void {
  const prev = entries.get(packId) ?? { state: "none" as ConsentState, kind: null, identity: "", local: false, error: null };
  entries.set(packId, { ...prev, ...patch });
  notify(packId);
}

/**
 * Ask for consent once per pack. Waiters share the in-flight request; a waiter whose own signal
 * aborts gets "aborted", and the shared request (and its sheet) is cancelled once nobody waits.
 */
export function requestConsent(
  seed: ConsentSeed,
  run: ConsentRunner,
  signal: AbortSignal,
): Promise<ConsentOutcome> {
  if (signal.aborted) return Promise.resolve("aborted");
  if (consentGranted(seed)) return Promise.resolve("ok");
  const packId = seed.id;
  let slot = pending.get(packId);
  if (!slot) {
    const controller = new AbortController();
    const identity = consentIdentity(seed);
    const cur = entries.get(packId);
    if (cur?.error) settleEntry(packId, { error: null });
    const promise = (async (): Promise<ConsentOutcome> => {
      await Promise.resolve(); // register the slot before a synchronous throw can settle it
      try {
        const out = await run(controller.signal);
        if (controller.signal.aborted) return "aborted";
        if (out === "declined") return "declined";
        settleEntry(packId, { state: "granted", kind: out, identity, local: true, error: null });
        return "ok";
      } catch (e) {
        if (controller.signal.aborted) return "aborted";
        const msg = e instanceof Error ? e.message : String(e);
        settleEntry(packId, { error: msg || "consent failed" });
        return "failed";
      } finally {
        if (pending.get(packId) === slot) pending.delete(packId);
        notify(packId);
      }
    })();
    slot = { promise, controller, waiters: 0 };
    pending.set(packId, slot);
    notify(packId);
  }
  const shared = slot;
  shared.waiters += 1;
  return new Promise<ConsentOutcome>((resolve) => {
    let done = false;
    const finish = (r: ConsentOutcome) => {
      if (done) return;
      done = true;
      signal.removeEventListener("abort", onAbort);
      shared.waiters -= 1;
      resolve(r);
    };
    const onAbort = () => {
      finish("aborted");
      if (shared.waiters <= 0 && pending.get(packId) === shared) {
        pending.delete(packId);
        shared.controller.abort();
        notify(packId);
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void shared.promise.then(finish);
  });
}

/** Pane / header wording for a pack that is waiting on the operator's OK. */
export function consentWaitMessage(name: string, state: ConsentState): string {
  if (state === "changed") return `${name} has changed since you approved it.`;
  if (state === "stale") return `${name} needs a fresh OK after an update.`;
  return `${name} needs your OK to run.`;
}

/** A grant made elsewhere (live monitor bump, MCP, CLI) for the pack's current content. */
export function noteConsentGranted(seed: ConsentSeed, kind: ConsentKind): void {
  settleEntry(seed.id, { state: "granted", kind, identity: consentIdentity(seed), local: true, error: null });
}

export function resetConsentStoreForTests(): void {
  for (const p of pending.values()) p.controller.abort();
  pending.clear();
  entries.clear();
  listeners.clear();
}
