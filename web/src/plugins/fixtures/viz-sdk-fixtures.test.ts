import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { VIZ_FIXTURES, VIZ_FIXTURE_NAMES } from "../../../../plugins/sdk/viz-fixtures";
import { VIZ_SDK_FIXTURE_BUILDERS, scrubVizCaptureState, type VizSdkFixtureName } from "./viz-sdk-frame-build";
import type { StateMsg } from "../../core/types";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const jsonDir = path.join(repoRoot, "plugins/sdk/fixtures");

/** Leaked NIC hardware addresses in committed JSON (colon or dash separators). */
const MAC_ADDRESS_IN_TEXT = /\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/i;

describe("viz sdk frozen fixtures", () => {
  for (const name of VIZ_FIXTURE_NAMES) {
    it(`rebuilds ${name} from host code`, () => {
      const built = VIZ_SDK_FIXTURE_BUILDERS[name as VizSdkFixtureName]();
      const frozen = JSON.parse(readFileSync(path.join(jsonDir, `${name}.json`), "utf8"));
      expect(built).toEqual(frozen);
      expect(VIZ_FIXTURES[name]).toEqual(frozen);
    });
  }

  it("golden-live-failed exposes high sys.failed from units alias", () => {
    expect(VIZ_FIXTURES["golden-live-failed"].sys?.failed).toBeGreaterThan(0.5);
    expect(VIZ_FIXTURES["golden-live"].sys?.failed ?? 0).toBeLessThanOrEqual(0.5);
  });

  it("committed sdk fixture JSON contains no MAC addresses", () => {
    for (const file of readdirSync(jsonDir).filter((f) => f.endsWith(".json"))) {
      const text = readFileSync(path.join(jsonDir, file), "utf8");
      expect(text, file).not.toMatch(MAC_ADDRESS_IN_TEXT);
    }
  });

  it("scrubs structural MAC ids to host-mac placeholders", () => {
    const state: StateMsg = {
      type: "state",
      ts: 1,
      iface: "",
      interfaces: [],
      network: "",
      local_ip: "10.0.0.1",
      gateway: "10.0.0.254",
      uptime: 0,
      stats: {
        pps: 0, bps: 0, devices: 0, online: 0, flows: 0, active_flows: 0, packets: 0, bytes: 0,
      },
      devices: [
        {
          ip: "10.0.0.2",
          mac: "aa:e4:ad:ca:84:e4",
          vendor: "",
          hostnames: [],
          names: [],
          sources: [],
          ports: [],
          ifaces: [],
          aliases: [],
          online: true,
          packets: 0,
          bytes_in: 0,
          bytes_out: 0,
        },
        {
          ip: "10.0.0.3",
          mac: "82-2B-38-3D-BC-D0",
          vendor: "",
          hostnames: [],
          names: [],
          sources: [],
          ports: [],
          ifaces: [],
          aliases: [],
          online: true,
          packets: 0,
          bytes_in: 0,
          bytes_out: 0,
        },
      ],
      flows: [],
      views: {
        wifi: {
          devices: [],
          flows: [],
          hub: "wifi:hub",
          self: "aa:e4:ad:ca:84:e4",
        },
      },
    };
    const scrubbed = scrubVizCaptureState(state);
    expect(scrubbed.devices.map((d) => d.mac).sort()).toEqual(["host-mac", "host-mac-02"]);
    expect(scrubbed.views?.wifi?.self).toMatch(/^host-mac(?:-\d{2})?$/);
    expect(JSON.stringify(scrubbed)).not.toMatch(MAC_ADDRESS_IN_TEXT);
  });

  it("vm-live is a quiet real capture with idle merge demo slices", () => {
    const frame = VIZ_FIXTURES["vm-live"];
    expect(frame.demo).toBe(true);
    expect(frame.demoSlices?.packets).toBe(true);
    expect(new Set(frame.talkers.map((t) => t.id)).size).toBe(frame.talkers.length);
    expect(frame.packets.length).toBeGreaterThan(0);
    expect(frame.headlines.some((h) => h.label && !/^host-\d+$/.test(h.label))).toBe(true);
  });
});
