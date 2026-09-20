export type SdmDevice = {
  id: string;
  label: string;
  room?: string;
  type?: string;
  camera?: boolean;
  webrtc?: boolean;
};

export type SdmEvent = {
  ts?: string;
  device?: string;
  kinds?: string[];
  event_id?: string;
};

export type SdmStatus = {
  linked?: boolean;
  pcm_url?: string | null;
  error?: string;
  devices?: SdmDevice[];
  events?: SdmEvent[];
  client_id?: string;
  enterprise_id?: string;
};

/** `grid` 0 means auto: one pane per chosen camera, capped at `NEST_GRID_MAX`. */
export type NestLook = { live: boolean; stills: boolean; pick: string; grid: number };

export const NEST_GRID_MAX = 6;

export const NEST_LAYOUTS: { value: string; label: string; hint: string }[] = [
  { value: "auto", label: "all", hint: "one pane per selected camera, up to six" },
  { value: "1", label: "1", hint: "one camera, full frame" },
  { value: "2", label: "2", hint: "two cameras side by side" },
  { value: "4", label: "2×2", hint: "four-camera wall" },
  { value: "6", label: "3×2", hint: "six-camera wall" },
];

export function nestStillSrc(device: string, event: string): string {
  return `/api/sdm/still?device=${encodeURIComponent(device)}&event=${encodeURIComponent(event)}`;
}

export function streamableCameras(devices: SdmDevice[] | undefined): SdmDevice[] {
  return (devices ?? []).filter((d) => d.camera !== false && d.type !== "display" && d.webrtc !== false);
}

function nestRoomCollides(cam: SdmDevice, catalog?: SdmDevice[]): boolean {
  const room = cam.room?.trim();
  if (!room || room === cam.label) return false;
  return !!catalog?.some((d) => d.id !== cam.id && d.label === room);
}

/** Wall label. Nest room is omitted when it is another camera's name (Verandah in "Lounge room"). */
export function nestCamCaption(cam: SdmDevice, catalog?: SdmDevice[]): string {
  const room = cam.room?.trim();
  if (!room || room === cam.label || nestRoomCollides(cam, catalog)) return cam.label;
  return `${cam.label} · ${room}`;
}

/** Chip tooltip — still mentions a colliding Nest room so the picker stays honest. */
export function nestCamHint(cam: SdmDevice, catalog?: SdmDevice[]): string {
  const room = cam.room?.trim();
  if (!room || room === cam.label) return cam.label;
  if (nestRoomCollides(cam, catalog)) return `${cam.label} (Nest room also named ${room})`;
  return `${cam.label} · ${room}`;
}

export function nestEventForPick(ev: SdmEvent, devices: SdmDevice[], pick: string): boolean {
  if (!ev.device || !ev.event_id) return false;
  const cam = devices.find((d) => d.id === ev.device || d.label === ev.device);
  if (!cam) return !parsePicks(pick).length;
  return nestPickPressed(pick, cam);
}

export function parsePicks(pick: string): string[] {
  return pick.split(",").map((s) => s.trim()).filter(Boolean);
}

/** 0 = auto (all selected cameras). Other values are a pane cap, 1–6. */
export function clampNestGrid(raw: string | undefined): number {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s || s === "auto") return 0;
  const n = Number(s);
  if (!Number.isFinite(n)) return 0;
  return Math.min(NEST_GRID_MAX, Math.max(1, Math.round(n)));
}

export function nestPaneCap(grid: number): number {
  if (grid <= 0) return NEST_GRID_MAX;
  return Math.min(NEST_GRID_MAX, Math.max(1, Math.round(grid)));
}

export function nestGridToken(grid: number): string {
  if (grid <= 0) return "auto";
  if (grid === 3) return "4";
  if (grid === 5) return "6";
  return String(nestPaneCap(grid));
}

export function parseNestLook(cfg: Record<string, string> | undefined): NestLook {
  const live = cfg?.live !== "0" && cfg?.live !== "false";
  const stills = cfg?.stills === "1" || cfg?.stills === "true";
  return { live, stills, pick: (cfg?.pick ?? "").trim(), grid: clampNestGrid(cfg?.grid) };
}

/** Motion stills sit under the wall when asked, or replace it when live is off. */
export function nestShowEventTiles(live: boolean, stills: boolean): boolean {
  return stills || !live;
}

export function nestIdleNote(live: boolean, events: SdmEvent[]): string {
  if (live) return "";
  if (events.some((e) => e.device && e.event_id)) return "";
  return "Live stream off. No recent motion stills.";
}

export function sdmSyncKey(sdm: SdmStatus | undefined, look: NestLook): string {
  return JSON.stringify({
    linked: sdm?.linked,
    pcm_url: sdm?.pcm_url,
    error: sdm?.error,
    devices: sdm?.devices,
    events: sdm?.events,
    live: look.live,
    stills: look.stills,
    pick: look.pick,
    grid: look.grid,
  });
}

export function firstCamera(devices: SdmDevice[] | undefined, pick: string): SdmDevice | null {
  return gridCameras(devices, pick, 1)[0] ?? null;
}

/**
 * Named picks are the wall (in order), capped by layout. Empty pick means every
 * streamable camera, still capped. Named picks are never padded with extras.
 */
export function gridCameras(devices: SdmDevice[] | undefined, pick: string, grid: number): SdmDevice[] {
  const cap = nestPaneCap(grid);
  const rows = devices ?? [];
  const named = parsePicks(pick);
  if (!named.length) return streamableCameras(rows).slice(0, cap);
  const used = new Set<string>();
  const out: SdmDevice[] = [];
  for (const want of named) {
    const hit = rows.find((d) => d.id === want || d.label === want);
    if (!hit || used.has(hit.id)) continue;
    used.add(hit.id);
    out.push(hit);
    if (out.length >= cap) break;
  }
  return out;
}

export function nestPickPressed(pick: string, cam: SdmDevice): boolean {
  const named = parsePicks(pick);
  if (!named.length) return true;
  return named.some((x) => x === cam.id || x === cam.label);
}

/** Toggle one camera. Empty pick means all streamable cameras are on. */
export function toggleNestPick(pick: string, cam: SdmDevice, catalog: SdmDevice[]): string {
  const labels = catalog.map((c) => c.label);
  const named = parsePicks(pick);
  const token = cam.label;
  const selected = named.length
    ? named
    : labels;
  const has = selected.some((x) => x === cam.id || x === cam.label);
  const next = has
    ? selected.filter((x) => x !== cam.id && x !== cam.label)
    : [...selected.filter((x) => x !== cam.id && x !== cam.label), token];
  if (!next.length || (next.length === labels.length && labels.every((l) => next.includes(l)))) return "";
  return next.join(", ");
}

export function nestStreamFailover(err: string): boolean {
  return /not available for streaming|internal error|unavailable|rate.?limit|try again/i.test(err);
}
