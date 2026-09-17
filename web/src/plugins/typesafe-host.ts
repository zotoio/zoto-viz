import type { StateMsg } from "../core/types";

/** Target frame interval for continuous Sense (60 fps). */
export const TYPESAFE_FRAME_BUDGET_MS = 16.7;

/** Minimum spare ms in the frame before a continuous Jev call is allowed. */
export const TYPESAFE_HEADROOM_MS = 4;

export const TYPESAFE_SETTINGS_KEY = "zoto-viz.typesafe";

export type TypeSafeSenseMode = "continuous" | "freeze" | "replay";

export interface TypeSafeQuestion {
  id: string;
  prompt: string;
}

export interface TypeSafeContract {
  questions?: TypeSafeQuestion[];
  stateRemap?: Record<string, string>;
}

export interface TypeSafeSenseResult {
  answer: unknown;
}

export interface TypeSafeShadowPayload {
  t: number;
  mode: TypeSafeSenseMode;
  ok: boolean;
  skipped?: "disabled" | "no-headroom" | "over-budget" | "no-sdk";
  answer?: unknown;
  headroomMs?: number;
  frameMs?: number;
  dt?: number;
}

export interface TypeSafeEnableFlags {
  /** `?typesafe=1` and/or settings toggle — enables continuous Sense when headroom allows. */
  continuous: boolean;
  /** `?sense=1` — user-initiated freeze-&-sense one-shot (no headroom gate). */
  freeze: boolean;
  /** `?sense=replay` — replay last freeze payload (no headroom gate). */
  replay: boolean;
}

export interface TypeSafeTickTiming {
  frameMs: number;
  headroomMs: number;
  dt: number;
}

export interface TypeSafeHostStats {
  sdkLoads: number;
  senseCalls: number;
  skipped: number;
}

export type TypeSafeSdkFactory = () => Promise<{ sense: TypeSafeSdk["sense"] }>;

export interface TypeSafeSdk {
  sense(input: { state: unknown; questions?: TypeSafeQuestion[] }): Promise<TypeSafeSenseResult>;
}

let sdkFactory: TypeSafeSdkFactory = async () => {
  const mod = await import("./typesafe-sdk.js");
  return mod.createTypeSafeSdk();
};

/** Test hook — replace the lazy import without touching production wiring. */
export function setTypeSafeSdkFactory(factory: TypeSafeSdkFactory): void {
  sdkFactory = factory;
}

export function resetTypeSafeSdkFactory(): void {
  sdkFactory = async () => {
    const mod = await import("./typesafe-sdk.js");
    return mod.createTypeSafeSdk();
  };
}

export function isTypeSafeCapability(cap: string): boolean {
  return cap === "typesafe";
}

export function pluginHasTypeSafe(caps: string[] | undefined): boolean {
  return !!caps?.includes("typesafe");
}

export function loadTypeSafeSettings(): boolean {
  try {
    return localStorage.getItem(TYPESAFE_SETTINGS_KEY) === "1";
  } catch {
    return false;
  }
}

export function setTypeSafeSettings(on: boolean): void {
  localStorage.setItem(TYPESAFE_SETTINGS_KEY, on ? "1" : "0");
}

/** Parse the three enable shapes from URL query + persisted settings. */
export function parseTypeSafeEnable(
  search = typeof location !== "undefined" ? location.search : "",
  settingsOn = loadTypeSafeSettings(),
): TypeSafeEnableFlags {
  const q = new URLSearchParams(search);
  const sense = q.get("sense");
  return {
    continuous: q.get("typesafe") === "1" || settingsOn,
    freeze: sense === "1",
    replay: sense === "replay",
  };
}

/** Parse optional `typesafe` block from plugin.yml (or typesafe.yml merge). */
export function parseTypeSafeContract(raw: unknown): TypeSafeContract | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const doc = raw as Record<string, unknown>;
  const out: TypeSafeContract = {};
  if (Array.isArray(doc.questions)) {
    const questions: TypeSafeQuestion[] = [];
    for (const row of doc.questions) {
      if (!row || typeof row !== "object" || Array.isArray(row)) continue;
      const r = row as Record<string, unknown>;
      const id = typeof r.id === "string" ? r.id.trim() : "";
      const prompt = typeof r.prompt === "string" ? r.prompt.trim() : "";
      if (id && prompt) questions.push({ id, prompt });
    }
    if (questions.length) out.questions = questions;
  }
  if (doc.stateRemap && typeof doc.stateRemap === "object" && !Array.isArray(doc.stateRemap)) {
    const remap: Record<string, string> = {};
    for (const [k, v] of Object.entries(doc.stateRemap as Record<string, unknown>)) {
      if (typeof k === "string" && typeof v === "string" && k && v) remap[k] = v;
    }
    if (Object.keys(remap).length) out.stateRemap = remap;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * Continuous Sense gate: present-to-present under 16.7 ms and at least 4 ms headroom.
 * One-shot freeze/replay bypasses the headroom check.
 */
export function typesafeSenseAllowed(
  mode: TypeSafeSenseMode,
  timing: TypeSafeTickTiming,
): { ok: true } | { ok: false; reason: "no-headroom" | "over-budget" } {
  if (mode === "freeze" || mode === "replay") return { ok: true };
  if (timing.dt > TYPESAFE_FRAME_BUDGET_MS) return { ok: false, reason: "over-budget" };
  if (timing.headroomMs < TYPESAFE_HEADROOM_MS) return { ok: false, reason: "no-headroom" };
  return { ok: true };
}

function remapState(state: StateMsg, remap?: Record<string, string>): StateMsg {
  if (!remap || !Object.keys(remap).length) return state;
  const out: StateMsg = { ...state };
  for (const [from, to] of Object.entries(remap)) {
    const val = (state as Record<string, unknown>)[from];
    if (val !== undefined) (out as Record<string, unknown>)[to] = val;
  }
  return out;
}

/**
 * Host-side TypeSafe / Jev integration. Dark by default: no SDK import until the
 * active pack declares `typesafe` and a user enable flag is set. Results land in
 * the shadow channel `plugin_state.typesafe` only — never UBO or viz skip paths.
 */
export class TypeSafeHost {
  private packHasCap = false;
  private enable: TypeSafeEnableFlags = { continuous: false, freeze: false, replay: false };
  private contract: TypeSafeContract | undefined;
  private shadow: TypeSafeShadowPayload | null = null;
  private lastShadow: TypeSafeShadowPayload | null = null;
  private prevTs = 0;
  private sdk: TypeSafeSdk | null = null;
  private freezeQueued = false;
  private _stats: TypeSafeHostStats = { sdkLoads: 0, senseCalls: 0, skipped: 0 };

  get stats(): TypeSafeHostStats {
    return { ...this._stats };
  }

  configure(opts: {
    packHasCap: boolean;
    enable: TypeSafeEnableFlags;
    contract?: TypeSafeContract;
  }): void {
    this.packHasCap = opts.packHasCap;
    this.enable = opts.enable;
    this.contract = opts.contract;
    if (opts.enable.freeze) this.freezeQueued = true;
    if (!this.isEnabled()) {
      this.sdk = null;
    }
  }

  /** Pack declares `typesafe` and at least one enable shape is active. */
  isEnabled(): boolean {
    return this.packHasCap && (this.enable.continuous || this.enable.freeze || this.enable.replay);
  }

  /** Shadow slice for `plugin_state.typesafe` — never written to UBO. */
  pluginStateSlice(): { typesafe: TypeSafeShadowPayload } | undefined {
    if (!this.shadow) return undefined;
    return { typesafe: this.shadow };
  }

  private async ensureSdk(): Promise<TypeSafeSdk | null> {
    if (!this.isEnabled()) return null;
    if (this.sdk) return this.sdk;
    this._stats.sdkLoads++;
    try {
      this.sdk = await sdkFactory();
      return this.sdk;
    } catch {
      return null;
    }
  }

  /**
   * Run Sense for this monitor tick. Continuous mode is headroom-gated; freeze/replay
   * are one-shot and bypass headroom. Never blocks the frame path on failure.
   */
  async tick(state: StateMsg, timing: TypeSafeTickTiming): Promise<void> {
    if (!this.packHasCap) {
      this.shadow = null;
      return;
    }

    let mode: TypeSafeSenseMode | null = null;
    if (this.freezeQueued && this.enable.freeze) {
      mode = "freeze";
      this.freezeQueued = false;
    } else if (this.enable.replay) {
      mode = "replay";
      this.enable = { ...this.enable, replay: false };
    } else if (this.enable.continuous) {
      mode = "continuous";
    }

    if (!mode) {
      this.shadow = null;
      return;
    }

    if (mode === "replay") {
      this.shadow = this.lastShadow
        ? { ...this.lastShadow, t: state.ts || Date.now() / 1000, mode: "replay", ok: true }
        : { t: state.ts || Date.now() / 1000, mode: "replay", ok: false, skipped: "disabled" };
      return;
    }

    const gate = typesafeSenseAllowed(mode, timing);
    if (!gate.ok) {
      this._stats.skipped++;
      this.shadow = {
        t: state.ts || Date.now() / 1000,
        mode,
        ok: false,
        skipped: gate.reason,
        headroomMs: timing.headroomMs,
        frameMs: timing.frameMs,
        dt: timing.dt,
      };
      return;
    }

    const sdk = await this.ensureSdk();
    if (!sdk) {
      this._stats.skipped++;
      this.shadow = {
        t: state.ts || Date.now() / 1000,
        mode,
        ok: false,
        skipped: "no-sdk",
        headroomMs: timing.headroomMs,
        frameMs: timing.frameMs,
        dt: timing.dt,
      };
      return;
    }

    const payload = remapState(state, this.contract?.stateRemap);
    this._stats.senseCalls++;
    const result = await sdk.sense({
      state: payload,
      questions: this.contract?.questions,
    });
    this.shadow = {
      t: state.ts || Date.now() / 1000,
      mode,
      ok: true,
      answer: result.answer,
      headroomMs: timing.headroomMs,
      frameMs: timing.frameMs,
      dt: timing.dt,
    };
    this.lastShadow = this.shadow;
    this.prevTs = state.ts || this.prevTs;
  }

  reset(): void {
    this.shadow = null;
    this.lastShadow = null;
    this.prevTs = 0;
    this.sdk = null;
    this.freezeQueued = false;
    this._stats = { sdkLoads: 0, senseCalls: 0, skipped: 0 };
  }
}
