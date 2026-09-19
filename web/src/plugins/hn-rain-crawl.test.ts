import { describe, expect, it } from "vitest";
import {
  HN_RAIN_CANVAS_DEFAULT,
  HN_RAIN_HEADER,
  HN_RAIN_PACE_DEFAULT,
  HN_RAIN_TILT_DEFAULT,
  HN_RAIN_TYPE_DEFAULT,
  hnRainCanvasSize,
  packHnRainBuffer,
  parseHnRainLook,
  preferHnTitles,
} from "../../../plugins/src/hn-rain/frontend/crawl";

describe("hn rain crawl look", () => {
  it("defaults to a slight rise and mid type size", () => {
    const look = parseHnRainLook();
    expect(look.type).toBe(HN_RAIN_TYPE_DEFAULT);
    expect(look.pace).toBe(HN_RAIN_PACE_DEFAULT);
    expect(look.pics).toBe(true);
    expect(look.tilt).toBeCloseTo(Math.tan((HN_RAIN_TILT_DEFAULT * Math.PI) / 180));
  });

  it("clamps angle, type, and pace from This view knobs", () => {
    expect(parseHnRainLook({ tilt: "40", type: "12" }).type).toBe(28);
    expect(parseHnRainLook({ tilt: "-40" }).tilt).toBeCloseTo(Math.tan((-20 * Math.PI) / 180));
    expect(parseHnRainLook({ tilt: "0", type: "80", pace: "9" })).toEqual({
      tilt: 0, type: 80, pace: 3, pics: true,
    });
    expect(parseHnRainLook({ pics: "0" }).pics).toBe(false);
    expect(parseHnRainLook({ pics: "1" }).pics).toBe(true);
  });

  it("packs tilt and type ahead of the glyph stream", () => {
    const look = parseHnRainLook({ tilt: "12", type: "64", pace: "1.6" });
    const buf = packHnRainBuffer(
      [{ id: "hn:0", label: "Hacker News", text: "Jemalloc" }],
      0.2,
      0.1,
      look,
    );
    expect(buf[4]).toBeCloseTo(look.tilt);
    expect(buf[5]).toBeCloseTo(0.64);
    expect(buf[6]).toBe(HN_RAIN_CANVAS_DEFAULT.w);
    expect(buf[7]).toBe(HN_RAIN_CANVAS_DEFAULT.h);
    expect(buf[8]).toBeCloseTo(look.pace);
    expect(Math.round(buf[HN_RAIN_HEADER]! * 95) + 32).toBe("J".charCodeAt(0));
  });

  it("packs the host canvas so the HN mark sits in the corner", () => {
    const buf = packHnRainBuffer(
      [{ id: "hn:0", label: "Hacker News", text: "Y" }],
      0,
      0,
      parseHnRainLook(),
      { w: 1920, h: 1080 },
    );
    expect(buf[6]).toBe(1920);
    expect(buf[7]).toBe(1080);
    expect(hnRainCanvasSize(null)).toEqual(HN_RAIN_CANVAS_DEFAULT);
    const fake = {
      querySelector(sel: string) {
        if (sel === "#wall > canvas") return { width: 1600, height: 900 };
        return null;
      },
    } as unknown as Document;
    expect(hnRainCanvasSize(fake)).toEqual({ w: 1600, h: 900 });
  });

  it("keeps NASA titles off the crawl", () => {
    expect(preferHnTitles([
      { id: "nasa:0", label: "NASA image of the day", text: "Nebula" },
      { id: "hn:0", label: "Hacker News", text: "Jemalloc" },
    ])).toEqual(["Jemalloc"]);
    expect(preferHnTitles([
      { id: "nasa:0", label: "NASA image of the day", text: "Nebula" },
    ])).toEqual([]);
  });
});
