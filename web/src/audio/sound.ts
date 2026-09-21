/** Header / Settings speaker master switch. Off by default — plugin SFX, arcade, and TTS stay silent. */

export const SOUND_STORE_KEY = "zoto-viz.sound";

export function parseSoundOn(raw: string | boolean | null | undefined): boolean {
  return raw === true || raw === "1" || raw === "on";
}

class LiveSound {
  private on = parseSoundOn(
    typeof localStorage !== "undefined" ? localStorage.getItem(SOUND_STORE_KEY) : null,
  );

  get soundOn(): boolean { return this.on; }

  setOn(next: boolean, persist = true): void {
    this.on = next;
    if (persist && typeof localStorage !== "undefined") localStorage.setItem(SOUND_STORE_KEY, next ? "1" : "0");
  }
}

export const liveSound = new LiveSound();

export function soundAllowed(on: boolean = liveSound.soundOn): boolean {
  return on;
}
