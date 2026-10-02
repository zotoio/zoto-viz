/** Microphone device is global and never stored on a profile. */
export const MIC_DEVICE_KEY = "zoto-viz.micDevice";

export type MicInput = { deviceId: string; label: string };

export function loadMicDevice(): string {
  try {
    return localStorage.getItem(MIC_DEVICE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function saveMicDevice(deviceId: string): void {
  try {
    if (!deviceId) localStorage.removeItem(MIC_DEVICE_KEY);
    else localStorage.setItem(MIC_DEVICE_KEY, deviceId);
  } catch { /* private mode */ }
}

export function micDeviceChoices(inputs: readonly MicInput[], permitted: boolean): { value: string; label: string }[] {
  const rows = [{ value: "", label: "System default" }];
  if (!permitted) return rows;
  for (const input of inputs) rows.push({ value: input.deviceId, label: input.label || "Microphone" });
  return rows;
}

export const MIC_DEVICE_HINT = "Allow the microphone to choose a device.";
export const MIC_DEVICE_MISSING = "Saved microphone isn't connected. Using the system default.";

/** `true` keeps the old `{ audio: true }` request. `false` means the mic stays closed. */
export function micCaptureRequest(policyOn: boolean, deviceId = loadMicDevice()): true | false | { deviceId: { exact: string } } {
  if (!policyOn) return false;
  if (!deviceId) return true;
  return { deviceId: { exact: deviceId } };
}

export function missingMicDevice(inputs: readonly MicInput[], saved = loadMicDevice()): boolean {
  if (!saved) return false;
  return !inputs.some((d) => d.deviceId === saved);
}
