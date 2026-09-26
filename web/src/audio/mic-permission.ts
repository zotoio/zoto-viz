export type MicPermissionState = "granted" | "prompt" | "denied" | "unknown";

/** Browser Permissions API when available (Chromium / Firefox). */
export async function queryMicPermissionState(): Promise<MicPermissionState> {
  if (typeof navigator === "undefined" || !navigator.permissions?.query) return "unknown";
  try {
    const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
    if (status.state === "granted" || status.state === "prompt" || status.state === "denied") {
      return status.state;
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}
