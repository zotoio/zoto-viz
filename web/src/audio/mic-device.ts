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

export type MicDeviceInfo = { kind: string; deviceId: string; label: string };

/** Names only after permission. Enumerate does not open the microphone. */
export async function listAudioInputs(
  enumerate: (() => Promise<readonly MicDeviceInfo[]>) | undefined,
  permitted: boolean,
): Promise<MicInput[]> {
  if (!permitted || !enumerate) return [];
  const all = await enumerate();
  const out: MicInput[] = [];
  for (const d of all) {
    if (d.kind !== "audioinput" || !d.deviceId) continue;
    out.push({ deviceId: d.deviceId, label: d.label });
  }
  return out;
}

let announcedMissingId = "";

/**
 * A saved id that is not plugged in becomes System default.
 * The signed line is returned once for that id.
 */
export function settleMicChoice(
  inputs: readonly MicInput[],
  permitted: boolean,
  saved = loadMicDevice(),
): { choices: { value: string; label: string }[]; value: string; announce: string | null } {
  const choices = micDeviceChoices(inputs, permitted);
  if (!permitted || !missingMicDevice(inputs, saved)) {
    if (saved && permitted) announcedMissingId = "";
    return { choices, value: saved, announce: null };
  }
  saveMicDevice("");
  const announce = announcedMissingId === saved ? null : MIC_DEVICE_MISSING;
  announcedMissingId = saved;
  return { choices, value: "", announce };
}

/** Policy off never calls `request`. A chosen device is `deviceId: { exact }`. */
export async function captureMic(
  policyOn: boolean,
  request: (constraints: MediaStreamConstraints) => Promise<MediaStream | null>,
): Promise<MediaStream | null> {
  const audio = micCaptureRequest(policyOn);
  if (audio === false) return null;
  return request({ audio, video: false });
}
