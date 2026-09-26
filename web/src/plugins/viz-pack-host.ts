import { vizClockMs } from "../core/viz-clock";
import { createNixieWallClock, packNixieWallBuffer } from "./nixie-wall-clock";
import type { VizDemoPackId } from "../ui/viz-hud";
import type { VizDataFrame, VizUniformValue } from "./viz-host";
import {
  TERM_COLS, TERM_ROWS, packScreen, preferHnStories, scriptFromStories, visibleScreen,
} from "../../../plugins/src/hn-term/frontend/teletype";
import { hnRainCanvasSize, packHnRainBuffer, parseHnRainLook } from "../../../plugins/src/hn-rain/frontend/crawl";
import { packStereoDrive, parseStereoTiming, stereoClockNow } from "../../../plugins/src/stereo-gram/frontend/drive";
import { packetTunnelSample } from "../../../plugins/src/packet-tunnel/frontend/tunnel";
import { CANVAS_DEFAULT, parseNixieLook, type NixieLook } from "../../../plugins/src/nixie-clock/frontend/tubes";

const hostNixieClock = createNixieWallClock();

let nixieScopedLook: NixieLook = parseNixieLook();
let nixieActiveLook: NixieLook = nixieScopedLook;
let nixieOptsKey = "";
let nixiePackCanvas = { ...CANVAS_DEFAULT };

function nixieOptsStableKey(opts?: Record<string, string> | null): string {
  if (!opts) return "";
  const keys = Object.keys(opts).sort();
  const o: Record<string, string> = {};
  for (const k of keys) o[k] = opts[k] ?? "";
  return JSON.stringify(o);
}

/** Parse nixie look when plugin options change (scope sync), not each frame. */
export function syncNixiePackScope(opts?: Record<string, string> | null): void {
  const key = nixieOptsStableKey(opts);
  if (key === nixieOptsKey) return;
  nixieOptsKey = key;
  nixieScopedLook = parseNixieLook(opts);
}

/** Track render-host backing size for nixie buffers (no querySelector). */
export function syncVizPackRenderCanvas(size: { w: number; h: number }): void {
  nixiePackCanvas = {
    w: size.w > 64 ? size.w : CANVAS_DEFAULT.w,
    h: size.h > 64 ? size.h : CANVAS_DEFAULT.h,
  };
}

export function resetNixiePackHostScope(): void {
  nixieOptsKey = "";
  nixieScopedLook = parseNixieLook();
  nixiePackCanvas = { ...CANVAS_DEFAULT };
}

export function nixiePackScopedLook(): NixieLook {
  return nixieScopedLook;
}

export function nixiePackActiveLook(): NixieLook {
  return nixieActiveLook;
}

export function hostNixieFormatCalls(): number {
  return hostNixieClock.formatCalls;
}

export interface VizPackHandlers {
  writeBuffer: (slot: number, data: number[]) => void;
  writeUniform: (name: string, value: VizUniformValue) => void;
  writeParticles: (data: number[], stride?: number) => void;
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

let termTyped = 0;
let termLastT = 0;
let termScript = "";

export function resetHnTermPack(): void {
  termTyped = 0;
  termLastT = 0;
  termScript = "";
}

function termNow(_frame: VizDataFrame): number {
  return vizClockMs() / 1000;
}

function hnTermFrameBuffer(frame: VizDataFrame): number[] {
  const next = scriptFromStories(preferHnStories(frame.headlines));
  if (next !== termScript) {
    termScript = next;
    termTyped = Math.min(termTyped, termScript.length);
  }
  const now = termNow(frame);
  const dt = termLastT > 0 ? Math.min(1, Math.max(0, now - termLastT)) : 1 / 60;
  termLastT = now;
  termTyped += dt * (28 + frame.audio * 18);
  if (termScript.length > 0 && termTyped > termScript.length + 40) termTyped = 0;
  const screen = visibleScreen(termScript, termTyped, TERM_COLS, TERM_ROWS);
  return packScreen(screen, frame.audio, Math.floor(frame.t * 2.4) % 2);
}

/** Host-side mirror of pack frontend onFrame handlers (no iframe). */
export function runPackFrameHandler(
  packId: VizDemoPackId,
  frame: VizDataFrame,
  handlers: VizPackHandlers,
  opts?: Record<string, string>,
): void {
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
      const buf: number[] = [];
      const n = Math.min(8, frame.talkers.length);
      for (let i = 0; i < n; i++) {
        buf.push((i / 8) * 2 - 1, ((i * 17) % 10) / 10, 0.1, 0.4);
      }
      handlers.writeBuffer(0, buf);
      handlers.writeUniform("uBright", 0.55);
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
      handlers.writeBuffer(0, hnTermFrameBuffer(frame));
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
      handlers.writeBuffer(0, packNixieWallBuffer(
        hostNixieClock,
        nixieActiveLook,
        frame.audio,
        peak,
        nixiePackCanvas,
      ));
      handlers.writeUniform("uAudio", frame.audio);
      handlers.writeUniform("uAccent", [1.0, 0.38, 0.06]);
      handlers.writeUniform("uBg", [0.06, 0.03, 0.02]);
      break;
    }
  }
}
