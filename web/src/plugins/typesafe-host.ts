import type { StateMsg } from "../core/types";
import { vizFrameEpochSec } from "../core/viz-clock";

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
  skipped?: "disabled" | "no-headroom" | "over-budget" | "no-api-key" | "no-sdk";
  answer?: unknown;
  /** Present-to-present interval (rAF clock, ms). */
  presentIntervalMs?: number;
  headroomMs?: number;
}

export interface TypeSafeEnableFlags {
  /** `?typesafe=1` and/or localStorage — enables continuous Sense when headroom allows. */
  continuous: boolean;
  /** `?sense=1` — user-initiated freeze-&-sense one-shot (no headroom gate). */
  freeze: boolean;
  /** `?sense=replay` — replay last freeze payload (no headroom gate). */
  replay: boolean;
}

/** Present-clock timing for continuous Sense (all values in ms). */
export interface TypeSafeTickTiming {
  presentIntervalMs: number;
  headroomMs: number;
}

export interface TypeSafeHostStats {
  sdkLoads: number;
  senseCalls: number;
  skipped: number;
}

export type TypeSafeSdkFactory = (proxyConfigured: boolean) => Promise<{ sense: TypeSafeSdk["sense"] }>;

export interface TypeSafeSdk {
  sense(input: { state: unknown; questions?: TypeSafeQuestion[] }): Promise<TypeSafeSenseResult>;
}

let proxyConfiguredResolver: () => boolean = () => false;

let sdkFactory: TypeSafeSdkFactory = async (configured) => {
  const mod = await import("./typesafe-sdk.js");
  return mod.createTypeSafeSdk(configured);
};

/** Test hook — replace the lazy import without touching production wiring. */
export function setTypeSafeSdkFactory(factory: TypeSafeSdkFactory): void {
  sdkFactory = factory;
}

export function resetTypeSafeSdkFactory(): void {
  sdkFactory = async (configured) => {
    const mod = await import("./typesafe-sdk.js");
    return mod.createTypeSafeSdk(configured);
  };
}

/** Test hook — stub monitor proxy availability without HTTP. */
export function setTypeSafeProxyConfigured(resolver: () => boolean): void {
  proxyConfiguredResolver = resolver;
}

export function resetTypeSafeProxyConfigured(): void {
  proxyConfiguredResolver = () => false;
}

export function typesafeProxyConfigured(): boolean {
  return proxyConfiguredResolver();
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

/** Parse the three enable shapes from URL query + persisted localStorage. */
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
 * Continuous Sense gate: present-to-present under 16.7 ms and at least 4 ms headroom
 * after monitor `feed()` work. `presentIntervalMs` is rAF clock; `headroomMs` is
 * frame-budget minus feed work. Freeze/replay bypass the gate.
 */
export function typesafeSenseAllowed(
  mode: TypeSafeSenseMode,
  timing: TypeSafeTickTiming,
): { ok: true } | { ok: false; reason: "no-headroom" | "over-budget" } {
  if (mode === "freeze" || mode === "replay") return { ok: true };
  if (timing.presentIntervalMs <= 0 || timing.presentIntervalMs > TYPESAFE_FRAME_BUDGET_MS) {
    return { ok: false, reason: "over-budget" };
  }
  if (timing.headroomMs < TYPESAFE_HEADROOM_MS) return { ok: false, reason: "no-headroom" };
  return { ok: true };
}

function remapState(state: StateMsg, remap?: Record<string, string>): StateMsg {
  if (!remap || !Object.keys(remap).length) return state;
  const out: StateMsg = { ...state };
  for (const [from, to] of Object.entries(remap)) {
    const val = (state as unknown as Record<string, unknown>)[from];
    if (val !== undefined) (out as unknown as Record<string, unknown>)[to] = val;
  }
  return out;
}

/**
 * Host-side TypeSafe / Jev integration. Dark by default: no proxy call until the
 * active pack declares `typesafe` and a user enable flag is set. Results land in
 * the shadow channel `plugin_state.typesafe` only — never UBO or viz skip paths.
 */
export class TypeSafeHost {
  private packHasCap = false;
  private enable: TypeSafeEnableFlags = { continuous: false, freeze: false, replay: false };
  private parsedEnable: TypeSafeEnableFlags = { continuous: false, freeze: false, replay: false };
  private contract: TypeSafeContract | undefined;
  private shadow: TypeSafeShadowPayload | null = null;
  private lastShadow: TypeSafeShadowPayload | null = null;
  private sdk: TypeSafeSdk | null = null;
  private freezeQueued = false;
  private senseInFlight = false;
  private _stats: TypeSafeHostStats = { sdkLoads: 0, senseCalls: 0, skipped: 0 };

  get stats(): TypeSafeHostStats {
    return { ...this._stats };
  }

  configure(opts: {
    packHasCap: boolean;
    enable: TypeSafeEnableFlags;
    contract?: TypeSafeContract;
  }): void {
    const prevParsed = this.parsedEnable;
    this.parsedEnable = opts.enable;
    this.packHasCap = opts.packHasCap;
    this.contract = opts.contract;
    this.enable.continuous = opts.enable.continuous;
    this.enable.freeze = opts.enable.freeze;
    if (opts.enable.freeze && !prevParsed.freeze) this.freezeQueued = true;
    if (opts.enable.replay && !prevParsed.replay) this.enable.replay = true;
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
      this.sdk = await sdkFactory(proxyConfiguredResolver());
      return this.sdk;
    } catch {
      return null;
    }
  }

  /**
   * Run Sense for this monitor tick. Continuous mode is headroom-gated on the
   * rAF present clock; freeze/replay are one-shot. Never blocks the frame path.
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
      if (this.senseInFlight) return;
      mode = "continuous";
    }

    if (!mode) {
      this.shadow = null;
      return;
    }

    if (mode === "replay") {
      this.shadow = this.lastShadow
        ? { ...this.lastShadow, t: vizFrameEpochSec(state.ts), mode: "replay", ok: true }
        : { t: vizFrameEpochSec(state.ts), mode: "replay", ok: false, skipped: "disabled" };
      return;
    }

    const gate = typesafeSenseAllowed(mode, timing);
    if (!gate.ok) {
      this._stats.skipped++;
      this.shadow = {
        t: vizFrameEpochSec(state.ts),
        mode,
        ok: false,
        skipped: gate.reason,
        presentIntervalMs: timing.presentIntervalMs,
        headroomMs: timing.headroomMs,
      };
      return;
    }

    if (!proxyConfiguredResolver()) {
      this._stats.skipped++;
      this.shadow = {
        t: vizFrameEpochSec(state.ts),
        mode,
        ok: false,
        skipped: "no-api-key",
        presentIntervalMs: timing.presentIntervalMs,
        headroomMs: timing.headroomMs,
      };
      return;
    }

    const sdk = await this.ensureSdk();
    if (!sdk) {
      this._stats.skipped++;
      this.shadow = {
        t: vizFrameEpochSec(state.ts),
        mode,
        ok: false,
        skipped: "no-sdk",
        presentIntervalMs: timing.presentIntervalMs,
        headroomMs: timing.headroomMs,
      };
      return;
    }

    const payload = remapState(state, this.contract?.stateRemap);
    this._stats.senseCalls++;
    this.senseInFlight = true;
    try {
      const result = await sdk.sense({
        state: payload,
        questions: this.contract?.questions,
      });
      this.shadow = {
        t: vizFrameEpochSec(state.ts),
        mode,
        ok: true,
        answer: result.answer,
        presentIntervalMs: timing.presentIntervalMs,
        headroomMs: timing.headroomMs,
      };
      this.lastShadow = this.shadow;
    } catch {
      this.shadow = {
        t: vizFrameEpochSec(state.ts),
        mode,
        ok: false,
        presentIntervalMs: timing.presentIntervalMs,
        headroomMs: timing.headroomMs,
      };
    } finally {
      this.senseInFlight = false;
    }
  }

  reset(): void {
    this.shadow = null;
    this.lastShadow = null;
    this.sdk = null;
    this.freezeQueued = false;
    this.senseInFlight = false;
    this._stats = { sdkLoads: 0, senseCalls: 0, skipped: 0 };
  }
}
