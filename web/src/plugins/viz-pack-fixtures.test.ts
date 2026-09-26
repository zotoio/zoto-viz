import { describe, expect, it } from "vitest";
import { runPackOnFixtures } from "../../../plugins/sdk/viz-fixtures";
import type { VizDataFrame } from "../../../plugins/sdk/viz-contract";
import {
  cicCanvasSize, EMPTY_SYS, packPackets, packRf, packSysSlot, packTalkers, parseCicLook,
} from "../../../plugins/src/cypher-cic/frontend/pack";
import { packetTunnelSample } from "../../../plugins/src/packet-tunnel/frontend/tunnel";
import { EMPTY_SYS_GAUGES, packSysGauges, sysconCanvasSize } from "../../../plugins/src/syscon/frontend/telemetry";
import { packHnRainBuffer, parseHnRainLook } from "../../../plugins/src/hn-rain/frontend/crawl";
import { packHnTermBuffer } from "./viz-pack-host";
import { packNixieBuffer, parseNixieLook } from "../../../plugins/src/nixie-clock/frontend/tubes";
import { DEMO_PACK_CONTRACTS, runPackFrameHandler } from "./dogfood-runner";
import { VizBufferWriter } from "./viz-host";
import type { VizDemoPackId } from "../ui/viz-hud";

type PackSurface = { buffers: number[][]; particles: number; uniforms: number };

function captureDemoPack(packId: VizDemoPackId, frame: VizDataFrame): PackSurface {
  const writer = new VizBufferWriter(DEMO_PACK_CONTRACTS[packId]);
  let uniforms = 0;
  runPackFrameHandler(packId, frame, {
    writeBuffer: (slot, data) => { writer.writeBuffer(slot, data); },
    writeUniform: () => { uniforms++; },
    writeParticles: (data, stride) => { writer.writeParticles(data, stride); },
  });
  const buffers: number[][] = [];
  for (let slot = 0; slot < DEMO_PACK_CONTRACTS[packId].maxBuffers; slot++) {
    const snap = Array.from(writer.snapshot(slot));
    if (snap.some((n) => n !== 0)) buffers.push(snap);
  }
  return { buffers, particles: writer.particleSnapshot().length, uniforms };
}

function expectNonEmpty(surface: PackSurface): void {
  expect(surface.buffers.length + surface.particles + surface.uniforms).toBeGreaterThan(0);
}

describe("pack fixtures", () => {
  const demoPacks: VizDemoPackId[] = [
    "packet-tunnel", "rf-constellation", "talker-storm", "kefrens-bars", "roto-proto",
    "blob-mesh", "star-sines", "hn-rain", "hn-term", "nixie-clock",
  ];

  for (const packId of demoPacks) {
    it(`${packId} produces a non-empty surface on idle and golden-live`, () => {
      runPackOnFixtures((frame) => {
        expectNonEmpty(captureDemoPack(packId, frame));
      });
    });
  }

  it("cypher-cic packs all slots on shared fixtures", () => {
    const look = parseCicLook({});
    runPackOnFixtures((frame) => {
      const sys = frame.sys ?? EMPTY_SYS;
      expect(packSysSlot(sys, frame.audio, cicCanvasSize(), look).length).toBeGreaterThan(0);
      expect(packTalkers(frame.talkers).length).toBeGreaterThan(0);
      expect(packPackets(frame.packets).length).toBeGreaterThan(0);
      expect(packRf(frame.rf).length).toBeGreaterThan(0);
    });
  });

  it("syscon packs gauges on shared fixtures", () => {
    runPackOnFixtures((frame) => {
      const buf = packSysGauges(frame.sys ?? EMPTY_SYS_GAUGES, frame.audio, sysconCanvasSize());
      expect(buf.length).toBeGreaterThan(0);
      expect(buf.some((n) => n !== 0)).toBe(true);
    });
  });

  it("packet-tunnel sample stays lit on fixtures", () => {
    runPackOnFixtures((frame) => {
      const sample = packetTunnelSample(frame);
      expect(sample.buffer.some((n) => n > 0)).toBe(true);
      expect(sample.bright).toBeGreaterThan(0);
    });
  });

  it("hn-rain and hn-term buffers encode fixture headlines", () => {
    runPackOnFixtures((frame) => {
      const rain = packHnRainBuffer(frame.headlines, frame.packets[0]?.field ?? 0, frame.audio, parseHnRainLook());
      expect(rain.length).toBeGreaterThan(2);
      const term = packHnTermBuffer(frame.headlines, frame.t * 10, frame.audio, 0);
      expect(term.length).toBeGreaterThan(2);
    });
  });

  it("nixie clock buffer fills on fixtures", () => {
    runPackOnFixtures((frame) => {
      const peak = Math.min(1, (frame.talkers[0]?.rate ?? 0) / 180);
      const buf = packNixieBuffer(new Date(0), parseNixieLook(), frame.audio, peak, { w: 1280, h: 800 });
      expect(buf.length).toBeGreaterThan(0);
    });
  });
});
