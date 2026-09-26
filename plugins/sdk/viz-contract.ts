/**
 * Standalone viz frame contract for plugin packs (zero runtime imports).
 * Copy or type-only-import this file from shipped zips; never import host internals.
 */

/**
 * Bump when frame slice shapes or host↔pack delivery semantics change.
 * v2: `VizPresentTick` + opt-in `viz.presentTick` in plugin.yml.
 */
export const VIZ_CONTRACT_VERSION = 2;

/**
 * Host → sandbox tick when `viz.presentTick` is true in plugin.yml.
 * Delivered once per sandbox per display frame (mosaic panes may share one sandbox).
 */
export interface VizPresentTick {
  /** rAF / vsync timestamp in milliseconds (`performance.now()` clock). */
  frameMs: number;
  /**
   * Host-supplied string; meaning undecided, pending the sandbox-per-tile decision
   * (one sandbox per tile vs one per pack with tile-keyed state). Do not rely on
   * `tileId` for per-tile simulation state until that decision lands.
   */
  tileId: string;
  /** Optional secondary clock in seconds (e.g. sky shader time); omit when unused. */
  pluginClock?: number;
  /** Host stage viewport width/height for OSD layout; omit when unused. */
  aspect?: number;
}

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

export interface VizTalkerSample {
  /** Stable talker id (often IP or alias). */
  id: string;
  /** Recent packet rate used for motion scaling. */
  rate: number;
  /** Role bucket: gateway, internet, lan, self, etc. */
  role: string;
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
