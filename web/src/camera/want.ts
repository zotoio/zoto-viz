export type CamConsumer = "live-sky" | "gaze" | "cam-theme";
export type CamPolicy = "auto" | "off";

export const CAM_STORE_KEY = "zoto-viz.camera";

export function parseCamPolicy(raw: string | null | undefined): CamPolicy {
  return raw === "auto" ? "auto" : "off";
}

/** Which webcam consumers an animation state needs. Sky cycle is not a consumer until the sky is actually `live`. */
export function cameraConsumers(opts: {
  backdrop: string;
  audioCamera: boolean;
  camGaze: number;
  camTheme: boolean;
}): CamConsumer[] {
  const out: CamConsumer[] = [];
  if (opts.backdrop === "live") out.push("live-sky");
  if (opts.audioCamera && opts.camGaze > 0.01) out.push("gaze");
  if (opts.camTheme) out.push("cam-theme");
  return out;
}

export function shouldRunCamera(policy: CamPolicy, consumers: Iterable<string>): boolean {
  if (policy === "off") return false;
  for (const _ of consumers) return true;
  return false;
}
