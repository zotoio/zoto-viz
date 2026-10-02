/**
 * #260: the legacy reader builds a sparse v2 envelope and never writes storage.
 * Values equal to today's defaults are inherit (omitted).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_DREAM } from "../graph/scene";
import { DEFAULT_THEME } from "./themes";
import {
  ANIM_STORAGE_KEYS,
  ARCADE_FAMILIES,
  encodeAnimStorage,
  readLegacyEnvelope,
  rereadLegacyEnvelope,
  type LegacyReadStore,
} from "./legacy-settings";

const REFUSED_TILES = JSON.stringify("abcdefghijklmnopq".split(""));

function memory(entries: Record<string, string>): LegacyReadStore & { setItem(): void; removeItem(): void; writes: () => number } {
  const keys = Object.keys(entries);
  let writes = 0;
  return {
    length: keys.length,
    key: (i) => keys[i] ?? null,
    getItem: (k) => (Object.prototype.hasOwnProperty.call(entries, k) ? entries[k]! : null),
    setItem: () => { writes += 1; },
    removeItem: () => { writes += 1; },
    writes: () => writes,
  };
}

function legacyFixture(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of ANIM_STORAGE_KEYS) {
    const sample = (DEFAULT_DREAM as unknown as Record<string, unknown>)[key];
    const encoded = encodeAnimStorage(key, sample);
    if (encoded != null) out[`zoto-viz.anim.${key}`] = encoded;
  }
  out["zoto-viz.anim.yawPeriod"] = "90";
  out["zoto-viz.anim.backdrop"] = "matrix";
  out["zoto-viz.anim.mosaic"] = "4";
  out["zoto-viz.anim.hero"] = "center";
  out["zoto-viz.anim.mosaicTiles"] = REFUSED_TILES;
  out["zoto-viz.anim.mosaicSkies"] = JSON.stringify({
    "plugin:koi-pond": "nebula",
    "plugin:koi-pond!2": "matrix",
  });
  out["zoto-viz.mosaicFocus"] = "plugin:koi-pond";
  out["zoto-viz.vizGovernor"] = "0";
  out["zoto-viz.plugin.koi-pond.gain"] = "3";
  out["zoto-viz.plugin.koi-pond:deep.gain"] = "9";
  out["zoto-viz.mode.plugin:talkers.rank"] = "rate";
  out["zoto-viz.mode.topology.layout"] = "radial";
  for (const family of ARCADE_FAMILIES) out[`zoto-viz.${family}.best`] = "12";
  return out;
}

describe("#260 legacy settings reader", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("(1) every legacy family lands on the sparse envelope", () => {
    // persistAnim names 88 anim keys. mosaicSkies is the 88th and becomes tile backdrops.
    expect(ANIM_STORAGE_KEYS).toHaveLength(87);
    expect(ARCADE_FAMILIES).toHaveLength(14);
    const main = readFileSync(resolve(import.meta.dirname, "../app/main.ts"), "utf8");
    const body = main.match(/^const ARCADE_STORAGE_RE = \/(.+)\/;$/m)?.[1] ?? "";
    const group = body.match(/\(([a-z|]+)\)/)?.[1] ?? "";
    expect(group.split("|")).toEqual([...ARCADE_FAMILIES]);

    const local = memory(legacyFixture());
    const session = memory({
      "zoto-viz.session.live": JSON.stringify({
        v: 1,
        profileId: "user",
        dirty: false,
        settings: { theme: "aurora", vizGovernor: false },
        newerIds: ["future"],
        legacy: true,
      }),
    });
    const env = readLegacyEnvelope({
      local,
      session,
      profile: { vizGovernor: false, theme: DEFAULT_THEME.id, legacy: true, newer: true },
    });

    expect(env.global.anim).toEqual({ yawPeriod: 90, backdrop: "matrix" });
    expect(env.global.theme).toBe("aurora");
    expect(env.global.governor).toBe(false);
    expect(env.walls.default.layout).toEqual({
      mosaic: "4",
      hero: "center",
      mosaicTiles: REFUSED_TILES,
      mosaicFocus: "plugin:koi-pond",
    });
    expect(env.walls.default.tiles).toEqual({
      "plugin:koi-pond": { look: { backdrop: "nebula" } },
      "plugin:koi-pond!2": { look: { backdrop: "matrix" } },
    });
    expect(JSON.stringify(env.walls.default.tiles)).not.toContain("separated");
    expect(env.walls.default.defaults).toEqual({ governor: false });
    expect(env.packs).toEqual({ "koi-pond": { config: { gain: "3" } } });
    expect(env.views["plugin:koi-pond:deep"]).toEqual({ config: { gain: "9" } });
    expect(env.views["plugin:talkers"]).toEqual({ mode: { rank: "rate" } });
    expect(env.views.topology).toEqual({ mode: { layout: "radial" } });
    for (const family of ARCADE_FAMILIES) {
      expect(env.views[family]).toEqual({ arcade: { best: "12" } });
    }
    expect(env.activeWall).toBe("default");
    expect(env.v).toBe(2);
  });

  it("(2) read, the in-memory legacy form, then read again is stable", () => {
    const sources = {
      local: memory(legacyFixture()),
      session: memory({
        "zoto-viz.session.live": JSON.stringify({
          v: 1,
          profileId: "user",
          settings: { theme: "aurora" },
        }),
      }),
      profile: { vizGovernor: false },
    };
    expect(rereadLegacyEnvelope(sources)).toEqual(readLegacyEnvelope(sources));
  });

  it("(3) the reader makes zero storage writes", () => {
    const local = memory(legacyFixture());
    const session = memory({});
    readLegacyEnvelope({ local, session, profile: { vizGovernor: false, v: 1 } });
    rereadLegacyEnvelope({ local, session });
    expect(local.writes()).toBe(0);
    expect(session.writes()).toBe(0);
  });
});
