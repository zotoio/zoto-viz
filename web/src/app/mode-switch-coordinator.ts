import type { ConsentReviewResult } from "./pack-consent";
import { abortAllOpenPackConsents, isPackConsentPending } from "./pack-consent";
import {
  bumpModeSwitchGeneration,
  getModeSwitchGeneration,
  isModeSwitchStale,
} from "./mode-switch-state";
import type { ApplyModeFlags } from "./apply-mode";

export type AutoSwitchKind = "dream-cycle" | "profile-restore";

export type ModeSwitchSource =
  | { channel: "user" }
  | { channel: "automatic"; auto: AutoSwitchKind };

export type PendingAutoSwitch = {
  auto: AutoSwitchKind;
  modeId: string;
  flags: ApplyModeFlags;
};

let pendingAutoSwitch: PendingAutoSwitch | null = null;
let dreamPulseReset: (() => void) | null = null;

export function registerDreamPulseReset(fn: () => void): void {
  dreamPulseReset = fn;
}

export function getPendingAutoSwitch(): PendingAutoSwitch | null {
  return pendingAutoSwitch;
}

export function clearPendingAutoSwitch(): void {
  pendingAutoSwitch = null;
}

export function resetModeSwitchCoordinatorForTests(): void {
  pendingAutoSwitch = null;
}

let runAutoSwitch: ((pending: PendingAutoSwitch) => void) | null = null;

export function registerAutoSwitchRunner(fn: (pending: PendingAutoSwitch) => void): void {
  runAutoSwitch = fn;
}

export type CoordinatorRun = {
  switchGen: number;
  proceed: boolean;
};

/**
 * Gate every mode switch. Returns generation + whether to call `applyModeImpl` now.
 */
export function beginCoordinatedModeSwitch(
  source: ModeSwitchSource,
  modeId: string,
  flags: ApplyModeFlags = {},
): CoordinatorRun {
  if (source.channel === "user") {
    const switchGen = bumpModeSwitchGeneration();
    abortAllOpenPackConsents();
    pendingAutoSwitch = null;
    return { switchGen, proceed: true };
  }

  if (isPackConsentPending()) {
    pendingAutoSwitch = { auto: source.auto, modeId, flags };
    return { switchGen: getModeSwitchGeneration(), proceed: false };
  }

  const switchGen = bumpModeSwitchGeneration();
  return { switchGen, proceed: true };
}

/** After consent settles: drop queued dream-cycle; maybe run profile restore once. */
export function settleConsentAndDrainAuto(
  result: ConsentReviewResult,
  declinedModeId?: string | null,
): void {
  const queued = pendingAutoSwitch;
  pendingAutoSwitch = null;
  if (
    declinedModeId
    && queued?.modeId === declinedModeId
    && (result === "declined" || result === "failed")
  ) {
    dreamPulseReset?.();
    return;
  }
  if (queued?.auto === "dream-cycle") {
    dreamPulseReset?.();
    return;
  }
  if (queued?.auto === "profile-restore") {
    if (result === "declined") runAutoSwitch?.(queued);
    return;
  }
  if (result === "ok" || result === "declined" || result === "failed") dreamPulseReset?.();
}

export { getModeSwitchGeneration, isModeSwitchStale };
