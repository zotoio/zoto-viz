import { describe, expect, it } from "vitest";
import {
  DICE_FEED_DENSITY, DICE_MOSAIC, DICE_NODE_TOP, DICE_SOFT, DEFAULT_DICE, capBound, diceBound, diceLookForRoll, diceMosaic,
  diceNumberBound, diceSelect, mergeDice, normalizeDice, pickOne, shuffleAnim, shuffleField, shuffleLook, snapBound,
} from "./shuffle";
import { shippedSettings } from "./profiles";
import { DEFAULT_DREAM, DREAM_BOUNDS } from "../graph/scene";
import type { PluginField } from "./modes";

const zero = () => 0;
const one = () => 0.999;

describe("snapBound / pickOne", () => {
  it("snaps to min and max", () => {
    const b = { min: 10, max: 20, step: 2 };
    expect(snapBound(b, zero)).toBe(10);
    expect(snapBound(b, one)).toBe(20);
  });

  it("picks a list entry without overflowing", () => {
    expect(pickOne(["a", "b", "c"], zero)).toBe("a");
    expect(pickOne(["a", "b", "c"], one)).toBe("c");
  });
});

describe("dice soft ceiling", () => {
  it("caps below the slider max without inverting the range", () => {
    expect(capBound({ min: 8, max: 120, step: 4 }, { max: 48 }).max).toBe(48);
    expect(capBound({ min: 16, max: 160, step: 4 }, { min: 32 }).min).toBe(32);
    expect(capBound({ min: 20, max: 30, step: 1 }, { max: 10 }).min).toBe(10);
  });

  it("keeps label / spark / mosaic dice under DREAM_BOUNDS", () => {
    expect(diceBound("labelCount", DREAM_BOUNDS.labelCount).max).toBeLessThan(DREAM_BOUNDS.labelCount.max);
    expect(diceBound("partCap", DREAM_BOUNDS.partCap).max).toBeLessThan(DREAM_BOUNDS.partCap.max);
    expect(diceBound("partPeak", DREAM_BOUNDS.partPeak).max).toBeLessThan(DREAM_BOUNDS.partPeak.max);
    expect(DICE_SOFT.partCap?.max).toBe(800);
    expect(DICE_MOSAIC).not.toContain("8");
    expect(DICE_FEED_DENSITY.max).toBeLessThan(80);
  });

  it("drops talkers / bluetooth top values above the node ceiling", () => {
    expect(diceSelect("top", ["10", "20", "40", "60", "80"])).toEqual(["10", "20", "40"]);
    expect(diceSelect("rank", ["bytes", "rate"])).toEqual(["bytes", "rate"]);
    const bt: PluginField = { key: "top", label: "max nodes", type: "number", min: 8, max: 64, step: 4 };
    expect(diceNumberBound(bt).max).toBe(DICE_NODE_TOP);
    expect(shuffleField(bt, one)).toBe(String(DICE_NODE_TOP));
  });
});

describe("shuffleField", () => {
  it("randomizes select / boolean / number and skips prompts", () => {
    const sel: PluginField = { key: "rank", label: "rank", type: "select", values: [["rate", "rate"], ["bytes", "bytes"]] };
    const flag: PluginField = { key: "on", label: "on", type: "boolean" };
    const num: PluginField = { key: "gain", label: "gain", type: "number", min: 1, max: 9, step: 1 };
    const prompt: PluginField = { key: "prompt", label: "prompt", type: "textarea" };
    const watch: PluginField = { key: "watch", label: "watch", type: "text" };
    expect(shuffleField(sel, zero)).toBe("rate");
    expect(shuffleField(flag, zero)).toBe("1");
    expect(shuffleField(flag, one)).toBe("0");
    expect(shuffleField(num, zero)).toBe("1");
    expect(shuffleField(prompt, zero)).toBeUndefined();
    expect(shuffleField(watch, zero)).toBeUndefined();
  });
});

describe("shuffleLook", () => {
  it("randomizes theme, view, mosaic, feed, knobs, and leaves chrome and privacy prompts alone", () => {
    const base = shippedSettings();
    base.theme = "nord";
    base.mode = "plugin:topology";
    base.anim = { ...base.anim, mosaic: "4", hero: "left" };
    base.redact = true;
    base.filters = { allowNames: "nest", blockNames: "", allowNets: "", blockNets: "" };
    base.chrome = "left";
    base.camera = "off";
    base.plugins = { topology: { rank: "rate", prompt: "keep me" } };
    const next = shuffleLook(base, {
      themes: ["nord", "matrix"],
      modes: [
        {
          id: "plugin:topology",
          options: [{ key: "rank", label: "rank", values: [["rate", "r"], ["bytes", "b"]], default: "rate" }],
        },
        {
          id: "plugin:talkers",
          options: [{ key: "top", label: "label top", values: [["10", "10"], ["20", "20"], ["40", "40"], ["60", "60"], ["80", "80"]], default: "40" }],
        },
      ],
      plugins: [
        {
          id: "topology",
          fields: [
            { key: "rank", label: "rank", type: "select", values: [["rate", "r"], ["bytes", "b"]] },
            { key: "prompt", label: "prompt", type: "textarea", default: "keep me" },
          ],
        },
        {
          id: "air-bt",
          fields: [{ key: "top", label: "max nodes", type: "number", min: 8, max: 64, step: 4, default: 32 }],
        },
      ],
      skies: ["fractal", "space"],
    }, one);
    expect(next.theme).toBe("matrix");
    expect(next.mode).toBe("plugin:talkers");
    expect(next.anim.mosaic).toBe("6");
    expect(next.anim.hero).toBe("right");
    expect(next.chrome).toBe("left");
    expect(next.camera).toBe("off");
    expect(next.mic).toBe("auto");
    expect(next.merge).toBe(false);
    expect(next.show.lan).toBe(false);
    expect(next.feed.on).toBe(false);
    expect(next.feed.density).toBeLessThanOrEqual(DICE_FEED_DENSITY.max);
    expect(next.plugins.topology?.rank).toBe("bytes");
    expect(next.plugins.topology?.prompt).toBe("keep me");
    expect(next.plugins["air-bt"]?.top).toBe(String(DICE_NODE_TOP));
    expect(next.modeOptions["plugin:talkers"]?.top).toBe("40");
    expect(next.redact).toBe(true);
    expect(next.filters.allowNames).toBe("nest");
    expect(next.dream).toBe(false);
    expect(next.dice.include.theme).toBe(true);
    expect(next.anim.yawPeriod).not.toBe(DEFAULT_DREAM.yawPeriod);
    expect(next.anim.camGaze).toBeDefined();
    expect(next.anim.labelCount).toBeLessThanOrEqual(diceBound("labelCount", DREAM_BOUNDS.labelCount).max);
    expect(next.anim.partCap).toBeLessThanOrEqual(diceBound("partCap", DREAM_BOUNDS.partCap).max);
    expect(next.anim.mosaicUniqueSkies).toBe(false);
    expect(next.anim.mosaicSkies).toEqual({});
  });

  it("gives every mosaic pane a different sky on a low roll", () => {
    const base = shippedSettings();
    base.mode = "plugin:topology";
    base.anim = {
      ...base.anim,
      mosaic: "4",
      hero: "off",
      mosaicTiles: ["plugin:topology", "plugin:talkers", "plugin:protocols", "plugin:wifi"],
    };
    base.dice = mergeDice(DEFAULT_DICE, { include: { mosaic: false } });
    const next = shuffleLook(base, {
      themes: ["nord"],
      modes: [
        { id: "plugin:topology" },
        { id: "plugin:talkers" },
        { id: "plugin:protocols" },
        { id: "plugin:wifi" },
      ],
      plugins: [],
      skies: ["aurora", "space", "fire", "ocean", "matrix"],
    }, zero);
    expect(next.anim.mosaicUniqueSkies).toBe(true);
    const skies = Object.values(next.anim.mosaicSkies ?? {});
    expect(skies.length).toBeGreaterThanOrEqual(4);
    expect(new Set(skies).size).toBe(skies.length);
  });

  it("skips groups the operator turned off", () => {
    const base = shippedSettings();
    base.theme = "nord";
    base.mode = "plugin:topology";
    base.chrome = "left";
    base.camera = "off";
    base.merge = true;
    base.anim = { ...base.anim, mosaic: "4", gravity: 0.2, yawPeriod: 150 };
    base.dice = mergeDice(DEFAULT_DICE, {
      include: { theme: false, view: false, mosaic: false, show: false, physics: false, knobs: false },
    });
    const next = shuffleLook(base, {
      themes: ["nord", "matrix"],
      modes: [
        { id: "plugin:topology" },
        { id: "plugin:talkers" },
      ],
      plugins: [{ id: "topology", fields: [{ key: "rank", label: "rank", type: "select", values: [["rate", "r"], ["bytes", "b"]] }] }],
      skies: ["fractal", "space"],
    }, one);
    expect(next.theme).toBe("nord");
    expect(next.mode).toBe("plugin:topology");
    expect(next.chrome).toBe("left");
    expect(next.camera).toBe("off");
    expect(next.merge).toBe(true);
    expect(next.anim.gravity).toBe(0.2);
    expect(next.anim.mosaic).toBe("4");
    expect(next.anim.hero).toBe(base.anim.hero);
    expect(next.plugins.topology).toBeUndefined();
  });
});

describe("shuffleAnim", () => {
  it("stays inside dice ceilings and picks a different sky", () => {
    const a = shuffleAnim({ ...DEFAULT_DREAM, mosaic: "4", hero: "center" }, { skies: ["fractal", "space"] }, one);
    expect(a.backdrop).toBe("space");
    expect(a.mosaic).toBe("6");
    expect(a.hero).toBe("right");
    expect(a.yawPeriod).toBeGreaterThanOrEqual(40);
    expect(a.yawPeriod).toBeLessThanOrEqual(480);
    expect(a.gravity).toBeGreaterThanOrEqual(0);
    expect(a.gravity).toBeLessThanOrEqual(2);
    expect(a.autoTune).toBe(true);
    expect(a.labelCount).toBe(diceBound("labelCount", DREAM_BOUNDS.labelCount).max);
    expect(a.partCap).toBe(diceBound("partCap", DREAM_BOUNDS.partCap).max);
    expect(a.partPeak).toBe(diceBound("partPeak", DREAM_BOUNDS.partPeak).max);
    expect(a.partCap).toBeLessThan(DREAM_BOUNDS.partCap.max);
    expect(a.labelCount).toBeLessThan(DREAM_BOUNDS.labelCount.max);
    expect(a.gridSize).toBeGreaterThanOrEqual(diceBound("gridSize", DREAM_BOUNDS.gridSize).min);
  });

  it("leaves motion or physics alone when that include is off", () => {
    const src = { ...DEFAULT_DREAM, mosaic: "4" as const, gravity: 0.2, yawPeriod: 150 };
    const motionOff = shuffleAnim(src, { skies: ["fractal", "space"] }, one, mergeDice(DEFAULT_DICE, { include: { motion: false } }));
    expect(motionOff.yawPeriod).toBe(150);
    expect(motionOff.backdrop).toBe(DEFAULT_DREAM.backdrop);
    expect(motionOff.gravity).not.toBe(0.2);
    const physOff = shuffleAnim(src, { skies: ["fractal"] }, one, mergeDice(DEFAULT_DICE, { include: { physics: false } }));
    expect(physOff.gravity).toBe(0.2);
    expect(physOff.yawPeriod).not.toBe(150);
    const mosaicOff = shuffleAnim(src, { skies: ["fractal"] }, one, mergeDice(DEFAULT_DICE, { include: { mosaic: false } }));
    expect(mosaicOff.mosaic).toBe("4");
    expect(mosaicOff.hero).toBe(src.hero);
    expect(mosaicOff.yawPeriod).not.toBe(150);
    const sharedOn = shuffleAnim(
      { ...src, mosaicSharedTheme: true },
      { skies: ["fractal"] },
      one,
    );
    expect(sharedOn.mosaicSharedTheme).toBe(true);
  });
});

describe("dice config", () => {
  it("normalizes partial blobs and mosaic max", () => {
    const n = normalizeDice({ include: { theme: false }, labelsMax: 200, mosaicMax: "8", feedDensityMax: 4 });
    expect(n.include.theme).toBe(false);
    expect(n.include.view).toBe(true);
    expect(n.labelsMax).toBe(DREAM_BOUNDS.labelCount.max);
    expect(n.mosaicMax).toBe("8");
    expect(diceMosaic(n)).toContain("8");
    expect(DICE_MOSAIC).not.toContain("8");
    expect(n.feedDensityMax).toBe(12);
    expect(n.handoff).toBe(false);
    expect(n.on).toBe(false);
    expect(n.periodMin).toBe(5);
    expect(normalizeDice({ on: true, periodMin: 90 }).on).toBe(true);
    expect(normalizeDice({ on: true, periodMin: 90 }).periodMin).toBe(60);
    expect(normalizeDice({ periodMin: 0 }).periodMin).toBe(1);
    expect(normalizeDice({ handoff: true }).handoff).toBe(false);
    expect(DEFAULT_DICE.handoff).toBe(false);
    expect(DEFAULT_DICE.on).toBe(false);
  });

  it("promotes view on a plugin sky so a roll can morph the graph", () => {
    const off = { ...DEFAULT_DICE, include: { ...DEFAULT_DICE.include, view: false } };
    expect(diceLookForRoll(off, { pinSky: true }).include.view).toBe(true);
    expect(diceLookForRoll(off, { stageOnly: true }).include.view).toBe(true);
    expect(diceLookForRoll(off, { forceView: true }).include.view).toBe(true);
    expect(diceLookForRoll(off, {}).include.view).toBe(false);
    expect(diceLookForRoll(DEFAULT_DICE, { pinSky: true }).include.view).toBe(true);
  });
});
