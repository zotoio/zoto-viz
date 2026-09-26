/** Monotonic generation — every `applyMode` (and HUD pack swap) bumps this. */
let modeSwitchGeneration = 0;

/** Last mode id that finished consent (`ok`); rollback target for stale/failed loads. */
let lastConsentedModeId = "";

export function bumpModeSwitchGeneration(): number {
  modeSwitchGeneration += 1;
  return modeSwitchGeneration;
}

export function getModeSwitchGeneration(): number {
  return modeSwitchGeneration;
}

export function isModeSwitchStale(generation: number): boolean {
  return generation !== modeSwitchGeneration;
}

export function getLastConsentedModeId(): string {
  return lastConsentedModeId;
}

export function setLastConsentedModeId(modeId: string): void {
  lastConsentedModeId = modeId;
}

export function resetModeSwitchStateForTests(): void {
  modeSwitchGeneration = 0;
  lastConsentedModeId = "";
}
