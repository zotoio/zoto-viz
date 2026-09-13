import { describe, expect, it } from "vitest";
import { canvasJpeg, captureHud, elText, includeView, pickAgentSettings, VIEW_KEY } from "./capture";
import { DEFAULT_FEED } from "./feed";

function hud(): void {
  document.body.innerHTML = `
    <span id="pps">12</span><span id="bps">1.2 MB/s</span><span id="fps">60</span>
    <span id="lanDevs">8</span><span id="lanOnline">6</span>
    <span id="netSvcs">4</span><span id="netOnline">3</span>
    <span id="flows">20</span><span id="active">5</span>
    <span id="net">wlan0 192.168.86.1</span>
    <div id="hint">talkers · LAN</div>
    <aside id="panel">Nest-Cam 192.168.86.40</aside>
  `;
}

describe("includeView", () => {
  it("defaults on and stores off as 0", () => {
    localStorage.removeItem(VIEW_KEY);
    expect(includeView()).toBe(true);
    localStorage.setItem(VIEW_KEY, "0");
    expect(includeView()).toBe(false);
    localStorage.setItem(VIEW_KEY, "1");
    expect(includeView()).toBe(true);
  });
});

describe("captureHud", () => {
  it("packs HUD text into short keys", () => {
    hud();
    const packed = captureHud({
      mode: "talkers",
      theme: "matrix",
      chrome: "top",
      dream: true,
      selected: "192.168.86.40",
      merge: false,
      redact: true,
      camera: "off",
      show: { lan: true, internet: false, multicast: false, offline: true, labels: true },
      feed: { ...DEFAULT_FEED, source: "transcript", layout: "ticker" },
      feedLines: ["you what's loud", "think looking at pps", "agent nest is the camera"],
    });
    expect(packed.m).toBe("talkers");
    expect(packed.th).toBe("matrix");
    expect(packed.d).toBe(1);
    expect(packed.mg).toBe(0);
    expect(packed.rd).toBe(1);
    expect(packed.sel).toBe("192.168.86.40");
    expect(packed.p).toContain("Nest-Cam");
    expect(packed.st).toContain("12pps");
    expect(packed.st).toContain("lan8/6");
    expect(packed.hide).toBe("inet,mc");
    expect(packed.fd).toBe("ticker/transcript/lan");
    expect(packed.q).toHaveLength(3);
    expect(JSON.stringify(packed).length).toBeLessThan(400);
    expect(elText("missing")).toBe("");
  });
});

describe("canvasJpeg", () => {
  it("returns null for an empty canvas", () => {
    const c = document.createElement("canvas");
    c.width = 0;
    c.height = 0;
    expect(canvasJpeg(c)).toBeNull();
  });

  it("strips the data URL prefix", () => {
    const c = document.createElement("canvas");
    c.width = 8;
    c.height = 8;
    c.toDataURL = () => `data:image/jpeg;base64,${"A".repeat(40)}`;
    expect(canvasJpeg(c)).toBe("A".repeat(40));
  });

  it("rejects a tiny or oversized payload", () => {
    const c = document.createElement("canvas");
    c.width = 4;
    c.height = 4;
    c.toDataURL = () => "data:image/jpeg;base64,short";
    expect(canvasJpeg(c)).toBeNull();
    c.toDataURL = () => `data:image/jpeg;base64,${"A".repeat(900_000)}`;
    expect(canvasJpeg(c)).toBeNull();
  });
});

describe("pickAgentSettings", () => {
  it("keeps only known keys and valid enums", () => {
    const p = pickAgentSettings({
      theme: "matrix",
      dream: true,
      camera: "off",
      chrome: "left",
      mode: "talkers",
      redact: true,
      merge: true,
      feed: { on: true, source: "transcript", layout: "ticker", scope: "selected", density: 99 },
      show: { internet: false, lan: true, bogus: true },
      plugins: { x: 1 },
    }, ["talkers", "topology"]);
    expect(p).toEqual({
      theme: "matrix",
      dream: true,
      camera: "off",
      chrome: "left",
      mode: "talkers",
      redact: true,
      merge: true,
      feed: { on: true, source: "transcript", layout: "ticker", scope: "selected" },
      show: { internet: false, lan: true },
    });
    expect(pickAgentSettings({ mode: "nope", camera: "maybe", chrome: "bottom" }, ["talkers"])).toEqual({});
  });
});
