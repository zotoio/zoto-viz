import type { DevicePixelSize } from "../graph/render-host";
import { vizClockMs, vizWallMs } from "../core/viz-clock";
import { createNixieWallClock } from "./nixie-wall-clock";
import { SharedNixieWallSecond } from "./nixie-wall-broadcast";
import { createNixieUploadLatch, nixieWallUploadDue, type NixieUploadLatch } from "./nixie-wall-upload";
import type { VizDemoPackId } from "../ui/viz-hud";
import type { VizDataFrame, VizUniformValue } from "./viz-host";
import {
  TERM_COLS, TERM_ROWS, packScreen, preferHnStories, scriptFromStories, visibleScreen,
} from "../../../plugins/src/hn-term/frontend/teletype";
import { HnTermFrameDriver } from "../../../plugins/src/hn-term/frontend/frame";
import { hnRainCanvasSize, packHnRainBuffer, parseHnRainLook } from "../../../plugins/src/hn-rain/frontend/crawl";
import { packStereoDrive, parseStereoTiming, stereoClockNow } from "../../../plugins/src/stereo-gram/frontend/drive";
import { packetTunnelSample } from "../../../plugins/src/packet-tunnel/frontend/tunnel";
import { packBlobMeshSlots } from "../../../plugins/sdk/blob-mesh-budget";
import { blobMeshNoticeLatchFor } from "./blob-mesh-devices-notice";
import {
  CANVAS_DEFAULT,
  NIXIE_LOOK_KEYS,
  parseNixieLook,
  type NixieLook,
  type NixieLookKey,
} from "../../../shared/nixie-tubes";

const hostNixieClock = createNixieWallClock();
const hostNixieWallSecond = new SharedNixieWallSecond();
const nixieUploadLatches = new Map<string, NixieUploadLatch>();

/** Mosaic / dogfood: stable tile key for per-tile nixie upload latch (not a nixie look key). */
export const VIZ_PACK_TILE_ID_OPT = "vizPackTileId";

export function packNixieWallBuffer(
  clock: ReturnType<typeof createNixieWallClock>,
  look: NixieLook = parseNixieLook(),
  audio = 0,
  pulse = 0,
  canvas?: { w: number; h: number },
): number[] {
  const wallMs = vizWallMs();
  const parts = hostNixieWallSecond.syncWallSecond(vizClockMs());
  return clock.tick(wallMs, look, audio, pulse, canvas, parts);
}

export function resetHostNixieWallScope(): void {
  hostNixieWallSecond.reset();
  nixieUploadLatches.clear();
}

function nixiePackTileId(opts?: Record<string, string> | null): string {
  const id = opts?.[VIZ_PACK_TILE_ID_OPT];
  return id && id.length > 0 ? id : "main";
}

function nixieUploadLatchFor(tileId: string): NixieUploadLatch {
  let latch = nixieUploadLatches.get(tileId);
  if (!latch) {
    latch = createNixieUploadLatch();
    nixieUploadLatches.set(tileId, latch);
  }
  return latch;
}

let nixieScopedLook: NixieLook = parseNixieLook();
let nixieActiveLook: NixieLook = nixieScopedLook;
const nixieOptSlots: (string | undefined)[] = NIXIE_LOOK_KEYS.map(() => undefined);
const nixiePackCanvas: DevicePixelSize = { w: CANVAS_DEFAULT.w, h: CANVAS_DEFAULT.h };

function nixieOptRaw(opts: Record<string, string> | null | undefined, key: NixieLookKey): string | undefined {
  if (opts == null || !Object.prototype.hasOwnProperty.call(opts, key)) return undefined;
  return opts[key] ?? "";
}

/** Parse nixie look when tracked option values change (no per-frame key stringify). */
export function syncNixiePackScope(opts?: Record<string, string> | null): void {
  let changed = false;
  for (let i = 0; i < NIXIE_LOOK_KEYS.length; i++) {
    const key = NIXIE_LOOK_KEYS[i]!;
    const v = nixieOptRaw(opts, key);
    if (nixieOptSlots[i] !== v) {
      nixieOptSlots[i] = v;
      changed = true;
    }
  }
  if (!changed) return;
  nixieScopedLook = parseNixieLook(opts, nixieScopedLook);
}

/** Track render-host backing size for nixie buffers (no querySelector). */
export function syncVizPackRenderCanvas(size: Readonly<DevicePixelSize>): void {
  nixiePackCanvas.w = size.w > 64 ? size.w : CANVAS_DEFAULT.w;
  nixiePackCanvas.h = size.h > 64 ? size.h : CANVAS_DEFAULT.h;
}

export function nixiePackActiveCanvas(): Readonly<DevicePixelSize> {
  return nixiePackCanvas;
}

export function resetNixiePackHostScope(): void {
  nixieOptSlots.fill(undefined);
  nixieScopedLook = parseNixieLook();
  nixiePackCanvas.w = CANVAS_DEFAULT.w;
  nixiePackCanvas.h = CANVAS_DEFAULT.h;
  resetHostNixieWallScope();
}

export function nixiePackScopedLook(): NixieLook {
  return nixieScopedLook;
}

export function nixiePackActiveLook(): NixieLook {
  return nixieActiveLook;
}

export interface VizPackHandlers {
  writeBuffer: (slot: number, data: number[]) => void;
  writeUniform: (name: string, value: VizUniformValue) => void;
  writeParticles: (data: number[], stride?: number) => void;
  /** Tile info caption (paintPackInfoCaption); null clears it. Called every frame. */
  setInfoNotice?: (text: string | null) => void;
}

function roleHue(role: string): number {
  if (role === "gateway") return 0.9;
  if (role === "internet") return 0.75;
  if (role === "lan") return 0.45;
  return 0.2;
}

/** ASCII 32–126 packed as (code-32)/95 so the sky can draw a 5×7 font. */
export { packHnRainBuffer, packStereoDrive };

export function packHnTermBuffer(
  headlines: { id: string; label: string; text: string; summary?: string }[],
  typed: number,
  audio: number,
  blink: number,
): number[] {
  const screen = visibleScreen(
    scriptFromStories(preferHnStories(headlines)),
    typed,
    TERM_COLS,
    TERM_ROWS,
  );
  return packScreen(screen, audio, blink);
}

const hostHnTermDriver = new HnTermFrameDriver();

/** Host-side mirror of pack frontend onFrame handlers (no iframe). */
export function runPackFrameHandler(
  packId: VizDemoPackId,
  frame: VizDataFrame,
  handlers: VizPackHandlers,
  opts?: Record<string, string>,
): void {
  // Only blob-mesh sets a tile info caption today; any other pack clears a stale one.
  if (packId !== "blob-mesh") handlers.setInfoNotice?.(null);
  switch (packId) {
    case "packet-tunnel": {
      const sample = packetTunnelSample(frame);
      handlers.writeBuffer(0, sample.buffer);
      handlers.writeUniform("uBright", sample.bright);
      handlers.writeUniform("uAccent", sample.accent);
      break;
    }
    case "rf-constellation": {
      const beacons = frame.rf;
      const buf: number[] = [];
      for (let i = 0; i < Math.min(8, beacons.length); i++) {
        const b = beacons[i]!;
        buf.push(b.rssi, b.channel / 165, i / 8);
      }
      handlers.writeBuffer(0, buf);
      const avg = beacons.reduce((s, b) => s + b.rssi, 0) / Math.max(1, beacons.length);
      handlers.writeUniform("uAudio", Math.min(1, frame.audio + avg * 0.25));
      handlers.writeUniform("uAccent", [0.2 + avg * 0.6, 0.45, 0.95 - avg * 0.3]);
      handlers.writeUniform("uOpacity", 0.65 + avg * 0.25);
      break;
    }
    case "talker-storm": {
      const particles: number[] = [];
      let count = 0;
      for (const talker of frame.talkers) {
        const n = Math.min(8, Math.ceil(talker.rate / 40));
        for (let i = 0; i < n && count < 512; i++, count++) {
          const hash = (talker.id.charCodeAt(0) + i * 17) % 97;
          particles.push(
            (hash / 97) * 2 - 1,
            roleHue(talker.role),
            (frame.t % 1) + i * 0.01,
            Math.min(1, talker.rate / 200),
          );
        }
      }
      handlers.writeParticles(particles, 4);
      handlers.writeBuffer(0, [count, frame.audio, frame.t % 1]);
      handlers.writeUniform("uBright", 0.4 + frame.audio * 0.5);
      handlers.writeUniform("uAudio", frame.audio);
      break;
    }
    case "kefrens-bars": {
      const buf: number[] = [];
      const n = Math.min(8, frame.talkers.length);
      for (let i = 0; i < n; i++) {
        const t = frame.talkers[i]!;
        buf.push(Math.min(1, t.rate / 180), (t.id.charCodeAt(0) % 97) / 97, i / 8, 0);
      }
      handlers.writeBuffer(0, buf);
      handlers.writeUniform("uBright", 0.55 + Math.min(1, (frame.talkers[0]?.rate ?? 0) / 200) * 0.4);
      handlers.writeUniform("uAudio", frame.audio);
      handlers.writeUniform("uAccent", [0.95, 0.45, 0.18]);
      break;
    }
    case "roto-proto": {
      const lead = frame.packets[0]?.field ?? 0;
      const mix = frame.packets.reduce((s, p) => s + p.field, 0) / Math.max(1, frame.packets.length);
      handlers.writeBuffer(0, [lead, mix, frame.t % 1, frame.audio]);
      handlers.writeUniform("uBright", 0.5 + mix * 0.4);
      handlers.writeUniform("uAudio", frame.audio);
      handlers.writeUniform("uAccent", [0.7, 0.95, 0.12]);
      break;
    }
    case "blob-mesh": {
      // Mirror of plugins/src/blob-mesh/frontend/index.ts (#161). This case runs right before
      // the draw (viz-frame-tick.ts), so its slot 0 is what the app shows. Both writers share
      // plugins/sdk/blob-mesh-budget.ts: floor first, then growth up to the whole coverage
      // budget (#174); placement from the device id, always in view.
      const blob = packBlobMeshSlots(frame.talkers, frame.t);
      handlers.writeBuffer(0, blob.slot0);
      // #173: when the minimums don't all fit, the quietest devices are dropped (never a silent
      // overlap) and the tile says how many, with ~3 s hysteresis each way.
      handlers.setInfoNotice?.(
        blobMeshNoticeLatchFor(nixiePackTileId(opts)).update(blob.plan.shownIdx.length, blob.plan.hidden, Date.now(), blob.plan.tieAtCut),
      );
      handlers.writeUniform("uBright", 0.8 + frame.audio * 0.2); // #174 UX Pro: size is the only rate signal, no rate term
      handlers.writeUniform("uAudio", frame.audio);
      handlers.writeUniform("uAccent", [0.25, 0.75, 0.95]);
      break;
    }
    case "star-sines": {
      const lead = frame.packets[0]?.field ?? 0;
      const depth = frame.packets.reduce((s, p) => s + p.field, 0) / Math.max(1, frame.packets.length);
      const t = frame.t;
      const seed = lead * 2.1 + depth * 1.3;
      const morph = 0.5 + 0.5 * Math.sin(t * 0.31 + lead * 4.0);
      const smile = 0.5 + 0.5 * Math.sin(t * 0.47 + depth * 3.0);
      const gaze = Math.sin(t * 0.55 + lead);
      const canvas = typeof document !== "undefined" ? document.querySelector("canvas") : null;
      const rw = canvas?.width || 1280;
      const rh = canvas?.height || 800;
      handlers.writeBuffer(0, [lead, depth, frame.packets.length / 32, frame.audio, seed, morph, smile, gaze, rw, rh]);
      handlers.writeUniform("uAudio", frame.audio);
      handlers.writeUniform("uAccent", [0.75, 0.85, 1.0]);
      break;
    }
    case "hn-rain": {
      handlers.writeBuffer(0, packHnRainBuffer(
        frame.headlines,
        frame.packets[0]?.field ?? 0,
        frame.audio,
        parseHnRainLook(opts),
        hnRainCanvasSize(typeof document !== "undefined" ? document : null),
      ));
      const n = frame.headlines.length;
      handlers.writeUniform("uBright", 0.92 + Math.min(0.2, n * 0.02));
      handlers.writeUniform("uAudio", frame.audio);
      handlers.writeUniform("uAccent", [0.35, 1.0, 0.42]);
      break;
    }
    case "hn-term": {
      handlers.writeBuffer(0, hostHnTermDriver.onFrame(frame));
      handlers.writeUniform("uAccent", [0.35, 1.0, 0.42]);
      handlers.writeUniform("uBg", [0.0, 0.04, 0.01]);
      break;
    }
    case "stereo-gram": {
      handlers.writeBuffer(0, packStereoDrive(frame.talkers, parseStereoTiming(opts), {
        clock: stereoClockNow(),
        level: frame.audio,
        bins: frame.spectrum,
      }));
      handlers.writeUniform("uAccent", [0.95, 0.35, 0.72]);
      handlers.writeUniform("uBg", [0.06, 0.03, 0.1]);
      break;
    }
    case "nixie-clock": {
      syncNixiePackScope(opts);
      nixieActiveLook = nixieScopedLook;
      const peak = Math.min(1, (frame.talkers[0]?.rate ?? 0) / 180);
      const wallMs = vizWallMs();
      const parts = hostNixieWallSecond.syncWallSecond(vizClockMs());
      const latch = nixieUploadLatchFor(nixiePackTileId(opts));
      if (nixieWallUploadDue(nixieActiveLook, parts, latch, nixiePackCanvas.w, nixiePackCanvas.h)) {
        handlers.writeBuffer(0, hostNixieClock.tick(
          wallMs,
          nixieActiveLook,
          frame.audio,
          peak,
          nixiePackCanvas,
          parts,
        ));
      }
      handlers.writeUniform("uAudio", frame.audio);
      handlers.writeUniform("uAccent", [1.0, 0.38, 0.06]);
      handlers.writeUniform("uBg", [0.06, 0.03, 0.02]);
      break;
    }
  }
}
