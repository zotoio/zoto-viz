import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SKY_RECIPE, PROMPT_REGEN_MS, currentSkyPrompt, lerpSkyRecipe, parseSkyRecipe, setSkyPrompt, skyForceQueued } from "./sky-ai";

describe("parseSkyRecipe", () => {
  it("reads a bare object and a fenced block", () => {
    const rec = parseSkyRecipe({ name: "wake", motif: 2, a: [0.1, 0.2, 0.3], b: [0.9, 0.8, 0.7], warp: 0.2, grain: 0.8, bands: 6 });
    expect(rec?.name).toBe("wake");
    expect(rec?.motif).toBe(2);
    expect(rec?.a).toEqual([0.1, 0.2, 0.3]);
    const clamped = parseSkyRecipe("```json\n{\"name\":\"x\",\"motif\":9,\"a\":[2,0,0],\"b\":[0,0,0],\"warp\":-1,\"grain\":2,\"bands\":99}\n```");
    expect(clamped?.motif).toBe(5);
    expect(clamped?.a[0]).toBe(1);
    expect(clamped?.warp).toBe(0);
    expect(clamped?.grain).toBe(1);
    expect(clamped?.bands).toBe(12);
    expect(parseSkyRecipe("nope")).toBeNull();
    expect(parseSkyRecipe(DEFAULT_SKY_RECIPE)?.name).toBe("harbour");
    const mid = lerpSkyRecipe(
      { ...DEFAULT_SKY_RECIPE, a: [0, 0, 0], b: [0, 0, 0], motif: 0 },
      { ...DEFAULT_SKY_RECIPE, name: "wake", a: [1, 1, 1], b: [1, 0, 0], motif: 3, warp: 1, grain: 1, bands: 8 },
      0.5,
    );
    expect(mid.a[0]).toBeCloseTo(0.5, 5);
    expect(mid.motif).toBe(3);
    expect(mid.name).toBe("wake");
    expect(lerpSkyRecipe(DEFAULT_SKY_RECIPE, { ...DEFAULT_SKY_RECIPE, motif: 5 }, 0).motif).toBe(0);
  });
});

describe("setSkyPrompt", () => {
  it("stores the profile view brief and ignores no-ops", () => {
    setSkyPrompt("cores", "  harbour dusk  ");
    expect(currentSkyPrompt()).toEqual({ view: "cores", prompt: "harbour dusk" });
    setSkyPrompt("cores", "harbour dusk");
    expect(currentSkyPrompt().prompt).toBe("harbour dusk");
    setSkyPrompt("talkers", "");
    expect(currentSkyPrompt()).toEqual({ view: "talkers", prompt: "" });
  });

  it("queues an immediate sky rebuild after the prompt settles", () => {
    vi.useFakeTimers();
    setSkyPrompt("cores", "teal mist");
    expect(skyForceQueued()).toBe(false);
    setSkyPrompt("cores", "teal mist and buoys");
    vi.advanceTimersByTime(PROMPT_REGEN_MS - 50);
    expect(skyForceQueued()).toBe(false);
    vi.advanceTimersByTime(100);
    expect(skyForceQueued()).toBe(true);
    expect(currentSkyPrompt().prompt).toBe("teal mist and buoys");
    vi.useRealTimers();
  });
});
