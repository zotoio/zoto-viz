import type { LookHit } from "./analyze";

export { findLook, isSkin } from "./analyze";

/**
 * Eased look direction from the shared webcam analysis (`liveCam.lookSample()`), in [-1, 1]:
 * +x is the right of the screen (the frame is mirrored so it matches a selfie view), +y is up.
 * `conf` is 0 when the camera is dark, denied, or the face is gone, so the orbit can ignore it.
 *
 * The pixel work (skin blob, pupil search) lives in `analyze.ts` and runs in the camera worker;
 * this class only smooths the latest hit so the orbit does not twitch between samples.
 */
export class Gaze {
  x = 0;
  y = 0;
  conf = 0;

  /** Feed the latest sample, or null while the camera is off / not wanted / nobody is in frame. */
  tick(hit: LookHit | null | undefined, dt: number): void {
    if (!hit) {
      this.decay(dt, 0);
      return;
    }
    const k = Math.min(1, dt * 5);
    this.x += (hit.x - this.x) * k;
    this.y += (hit.y - this.y) * k;
    this.conf += (hit.conf - this.conf) * k;
  }

  private decay(dt: number, conf: number): void {
    const k = Math.min(1, dt * 1.6);
    this.x += (0 - this.x) * k;
    this.y += (0 - this.y) * k;
    this.conf += (conf - this.conf) * k;
  }
}
