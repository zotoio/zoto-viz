import { describe, expect, it } from "vitest";
import { assetIdFromHref, isNasaStillDeco, isNasaStillUrl } from "./nasa-stills";

describe("isNasaStillUrl", () => {
  it("matches nasa.gov stills and the source-image proxy", () => {
    expect(isNasaStillUrl("https://www.nasa.gov/wp-content/uploads/a.jpg")).toBe(true);
    expect(isNasaStillUrl("https://apod.nasa.gov/apod/image/x.jpg")).toBe(true);
    expect(isNasaStillUrl("https://earthobservatory.nasa.gov/images/x")).toBe(true);
    expect(isNasaStillUrl("/api/sources/image?url=https%3A%2F%2Fwww.nasa.gov%2Fa.jpg")).toBe(true);
  });

  it("leaves other stills and local assets alone", () => {
    expect(isNasaStillUrl("https://upload.wikimedia.org/wikipedia/commons/a.jpg")).toBe(false);
    expect(isNasaStillUrl("https://images.metmuseum.org/a.jpg")).toBe(false);
    expect(isNasaStillUrl("/api/ai/assets/d3060344229da9e7")).toBe(false);
    expect(isNasaStillUrl("/skies/earth.jpg")).toBe(false);
    expect(isNasaStillUrl("")).toBe(false);
  });
});

describe("isNasaStillDeco", () => {
  it("uses the recorded origin when the href is a local asset", () => {
    expect(isNasaStillDeco({ src: "/api/ai/assets/d3060344229da9e7" })).toBe(false);
    expect(isNasaStillDeco(
      { src: "/api/ai/assets/d3060344229da9e7" },
      { d3060344229da9e7: "https://www.nasa.gov/a.jpg" },
    )).toBe(true);
    expect(isNasaStillDeco({ src: "/api/ai/assets/abc", from: "https://apod.nasa.gov/x.jpg" })).toBe(true);
    expect(isNasaStillDeco({ src: "https://www.nasa.gov/a.jpg" })).toBe(true);
  });
});

describe("assetIdFromHref", () => {
  it("reads the local asset id", () => {
    expect(assetIdFromHref("/api/ai/assets/d3060344229da9e7")).toBe("d3060344229da9e7");
    expect(assetIdFromHref("https://www.nasa.gov/a.jpg")).toBeNull();
  });
});
