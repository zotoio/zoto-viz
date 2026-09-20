import { describe, expect, it } from "vitest";
import { hnRainStillSrc, hnRainStillTitles, preferHnStillTitles, waitHnRainStill, warmHnRainStills } from "./hn-rain-stills";

describe("hn rain stills", () => {
  it("keeps titles in source order", () => {
    const rows = preferHnStillTitles([
      { id: "lab:0", label: "Lab", text: "Notes" },
      { id: "hn:0", label: "Hacker News", text: "Jemalloc" },
      { id: "hn:1", label: "HN", text: "Waymo" },
    ]);
    expect(rows.map((r) => r.text)).toEqual(["Notes", "Jemalloc", "Waymo"]);
  });

  it("asks Composer 2.5 even when a source enclosure is present", () => {
    expect(hnRainStillSrc("Jemalloc")).toBe(
      `/api/plugins/hn-rain/still?title=${encodeURIComponent("Jemalloc")}`,
    );
  });

  it("queues a still for every HN title", () => {
    const titles = hnRainStillTitles([
      { id: "hn:0", label: "Hacker News", text: "Jemalloc" },
      { id: "hn:1", label: "HN", text: "Waymo" },
      { id: "nasa:0", label: "NASA", text: "Nebula" },
    ]);
    expect(titles).toEqual(["Jemalloc", "Waymo", "Nebula"]);
    const hits: string[] = [];
    warmHnRainStills(titles, (async (url) => {
      hits.push(String(url));
      return new Response("{}", { status: 202 });
    }) as typeof fetch);
    expect(hits).toEqual([
      hnRainStillSrc("Jemalloc"),
      hnRainStillSrc("Waymo"),
      hnRainStillSrc("Nebula"),
    ]);
  });

  it("retries a pending still until Composer returns SVG", async () => {
    let n = 0;
    const src = await waitHnRainStill("Jemalloc", (async () => {
      n += 1;
      if (n < 3) return new Response("{}", { status: 202 });
      return new Response("<svg></svg>", { status: 200, headers: { "content-type": "image/svg+xml" } });
    }) as typeof fetch, async () => {});
    expect(n).toBe(3);
    expect(src).toBe(hnRainStillSrc("Jemalloc"));
  });
});
