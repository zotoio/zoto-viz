/**
 * Standalone viz frame contract for plugin packs (zero runtime imports).
 * Copy or type-only-import this file from shipped zips; never import host internals.
 */

/** Bump when frame slice shapes or semantics change. */
export const VIZ_CONTRACT_VERSION = 2;

export interface VizPacketSample {
  /** Uppercased protocol label from the decimated capture slice (e.g. TCP, UDP). */
  proto: string;
  /** Representative packet size in bytes for this sample row. */
  size: number;
  /** Size scaled to 0..1 for sky fields (no graph walk). */
  field: number;
}

export interface VizRfBeacon {
  /** SSID or placeholder label for the RF row. */
  ssid: string;
  /** Normalized RSSI 0..1 from the host (`normalizeRssi`; 1 is strongest). */
  rssi: number;
  /** Wi-Fi channel number. */
  channel: number;
}

export interface VizLinkSample {
  /** Talker id for the source host (same id space as `talkers[].id`). */
  src: string;
  /** Talker id for the destination host. */
  dst: string;
  /** Directional packet rate over the frame window (packets/s). */
  rate: number;
}

export interface VizTalkerSample {
  /** Stable talker id (often IP or alias). */
  id: string;
  /** Recent packet rate in packets/s when flow directional rates exist; otherwise the device packet counter (monotonic, not normalized to /s). Same field space as `links[].rate` when live. */
  rate: number;
  /** Role bucket: gateway, internet, lan, self, etc. */
  role: string;
  /** Per-host failed-connection ratio 0..1 (RST/refused over SYN attempts in the window). */
  failed?: number;
}

export interface VizHeadline {
  /** Stable headline id from the bound source. */
  id: string;
  /** Short source label shown in the feed chrome. */
  label: string;
  /** Primary headline text. */
  text: string;
  /** Optional kind tag from the source parser. */
  kind?: string;
  /** Optional longer summary or blurb. */
  summary?: string;
  /** Optional image URL for rich headlines. */
  image?: string;
}

/** Compact this-host SYS gauges (0..1). Missing views stay 0. */
export interface VizSysTelemetry {
  /** CPU load on the monitor host hub device. */
  cpu: number;
  /** Memory pressure on the monitor host. */
  mem: number;
  /** Disk utilization on the monitor host. */
  disk: number;
  /** GPU utilization when exposed by the host view. */
  gpu: number;
  /** Package temperature normalized 0..1. */
  temp: number;
  /** Power draw normalized 0..1 (RAPL / GPU watts). */
  watts: number;
  /** PSI memory stall pressure 0..1. */
  psi: number;
  /** Open socket count scaled 0..1. */
  sockets: number;
  /** Failed systemd units on the monitor host, divided by 4 and clamped 0..1 (machine-wide). */
  failed: number;
  /** Recent udev events scaled 0..1. */
  udev: number;
}

/** Host-decimated snapshot delivered to viz.read plugins each frame. */
export interface VizDataFrame {
  /** Present on v2 frames; omitted on legacy v1-shaped frames. Matches {@link VIZ_CONTRACT_VERSION}. */
  contract?: number;
  /** Monotonic frame time in seconds. */
  t: number;
  /** Delta since the previous delivered frame in seconds. */
  dt: number;
  /** Master audio level 0..1. */
  audio: number;
  /** Decimated protocol/size samples (no per-packet host field). */
  packets: VizPacketSample[];
  /** Wi-Fi / RF beacon rows from the watch slice. */
  rf: VizRfBeacon[];
  /** Top talkers by rate from the LAN slice. */
  talkers: VizTalkerSample[];
  /** Directional host-pair rates (v2); omitted when link collection is disabled. */
  links?: VizLinkSample[];
  /** Count of pair rows dropped by the top-N cap (v2). */
  linksDropped?: number;
  /** Headlines from bound sources (HN, RSS, etc.). */
  headlines: VizHeadline[];
  /** True when any slice was filled from viz.idle (host fixture or inline seed). */
  demo?: boolean;
  /** Per-slice flags for idle-filled slices — drives pack-specific HUD demo cues. */
  demoSlices?: Partial<Record<"packets" | "rf" | "talkers" | "headlines", true>>;
  /** Linux SYS gauges for holotable / CIC plugins. */
  sys?: VizSysTelemetry;
  /** Optional spectrum bins (low frequency first) for analyser skies. */
  spectrum?: number[];
}

export const EMPTY_SYS_TELEMETRY: VizSysTelemetry = {
  cpu: 0,
  mem: 0,
  disk: 0,
  gpu: 0,
  temp: 0,
  watts: 0,
  psi: 0,
  sockets: 0,
  failed: 0,
  udev: 0,
};
