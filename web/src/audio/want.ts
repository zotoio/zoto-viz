export type MicPolicy = "auto" | "off";

export const MIC_STORE_KEY = "zoto-viz.mic";

export function parseMicPolicy(raw: string | null | undefined): MicPolicy {
  return raw === "off" ? "off" : "auto";
}

/** Pulse mic runs only when the header policy is Auto, drive is mic, and something is modulated. */
export function shouldRunMic(policy: MicPolicy, drive: string, live: boolean): boolean {
  return policy === "auto" && drive === "mic" && live;
}

class LiveMic {
  private policy: MicPolicy = parseMicPolicy(
    typeof localStorage !== "undefined" ? localStorage.getItem(MIC_STORE_KEY) : "auto",
  );

  get micPolicy(): MicPolicy { return this.policy; }

  setPolicy(next: MicPolicy, persist = true): void {
    this.policy = next;
    if (persist && typeof localStorage !== "undefined") localStorage.setItem(MIC_STORE_KEY, next);
  }
}

export const liveMic = new LiveMic();
