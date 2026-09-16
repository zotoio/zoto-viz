import { describe, expect, it } from "vitest";
import {
  OddsStrip, TemperRail, forecastHits, ollamaTemperature, skyRebuildDue, temperBand,
  WEATHER_ODDS, PREFIX,
} from "./temper";

describe("temper math", () => {
  it("maps 0–100 onto bands and Ollama temperature", () => {
    expect(temperBand(0)).toBe("hush");
    expect(temperBand(22)).toBe("hush");
    expect(temperBand(36)).toBe("even");
    expect(temperBand(62)).toBe("keen");
    expect(temperBand(88)).toBe("feral");
    expect(ollamaTemperature(0)).toBe(0.1);
    expect(ollamaTemperature(22)).toBe(0.4);
    expect(ollamaTemperature(100)).toBe(1.45);
    expect(PREFIX.hush).toMatch(/terse/);
    expect(PREFIX.even).toMatch(/clearly different/);
    expect(PREFIX.even).toMatch(/physics/);
    expect(PREFIX.keen).toMatch(/physics/);
    expect(PREFIX.feral).toMatch(/physics/);
    expect(PREFIX.feral).toMatch(/unhinged/);
  });

  it("forecasts more hits for storm than hush", () => {
    const hush = forecastHits("hush").filter(Boolean).length;
    const storm = forecastHits("storm").filter(Boolean).length;
    expect(storm).toBeGreaterThan(hush);
    expect(WEATHER_ODDS.storm.p).toBeGreaterThan(WEATHER_ODDS.drift.p);
    expect(WEATHER_ODDS.drift.tickMs).toBeLessThan(60_000);
  });

  it("rebuild due wait / miss / hit", () => {
    expect(skyRebuildDue(0, 1000, 60_000, 0.5, 0)).toBe("hit");
    expect(skyRebuildDue(1000, 2000, 60_000, 0.5, 0)).toBe("wait");
    expect(skyRebuildDue(1000, 70_000, 60_000, 0.5, 0.9)).toBe("miss");
    expect(skyRebuildDue(1000, 70_000, 60_000, 0.5, 0.1)).toBe("hit");
  });
});

describe("temper rail and odds strip", () => {
  it("renders named bands and a probability forecast", () => {
    const rail = new TemperRail({ value: 8 });
    expect(rail.el.querySelector("input[aria-label=temper]")).toBeTruthy();
    expect(rail.el.textContent).toMatch(/hush/);
    expect(rail.el.textContent).toMatch(/terse/);
    rail.value = 90;
    expect(rail.el.dataset.band).toBe("feral");

    const odds = new OddsStrip({ value: "pulse" });
    expect(odds.el.querySelectorAll(".odds-band")).toHaveLength(4);
    expect(odds.el.querySelector(".odds-forecast")?.children.length).toBe(16);
    expect(odds.el.querySelector('[data-weather=pulse]')?.getAttribute("aria-checked")).toBe("true");
    odds.value = "storm";
    expect(odds.value).toBe("storm");
  });
});
