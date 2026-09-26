/** Last mode id that finished consent (`ok`); rollback target for decline/failed loads. */
let lastConsentedModeId = "";

export function getLastConsentedModeId(): string {
  return lastConsentedModeId;
}

export function setLastConsentedModeId(modeId: string): void {
  lastConsentedModeId = modeId;
}

export function resetModeSwitchStateForTests(): void {
  lastConsentedModeId = "";
}
