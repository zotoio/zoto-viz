import { describe, expect, it } from "vitest";
import { decoHtml, mergeAgentLook, normalizeAgentLook, sanitizeSvg } from "./deco";

describe("sanitizeSvg", () => {
  it("keeps an svg and strips script handlers", () => {
    const out = sanitizeSvg(`<svg viewBox="0 0 8 8" onclick="alert(1)"><script>x()</script><circle cx="4" cy="4" r="3"/></svg>`);
    expect(out).toContain("<svg");
    expect(out).toContain("xmlns=");
    expect(out).not.toContain("script");
    expect(out).not.toContain("onclick");
    expect(sanitizeSvg("<div>nope</div>")).toBe("");
  });
});

describe("normalizeAgentLook", () => {
  it("keeps photos and drops junk", () => {
    const look = normalizeAgentLook({
      shader: "vec3 color(vec3 dir, float t) { return uAccent; }",
      decos: [
        { id: "a", kind: "photo", src: "/api/ai/assets/abc", at: "selected" },
        { id: "b", kind: "photo", src: "javascript:alert(1)" },
        { id: "c", kind: "svg", src: "<svg></svg>", at: [0, 1, 2] },
        { id: "nasa", kind: "photo", src: "https://www.nasa.gov/a.jpg", at: "origin" },
        { id: "apod", kind: "photo", src: "/api/ai/assets/d3060344229da9e7", from: "https://apod.nasa.gov/x.jpg" },
      ],
    });
    expect(look.shader).toContain("color");
    expect(look.decos).toHaveLength(2);
    expect(look.decos.map((d) => d.id)).toEqual(["a", "c"]);
    expect(look.decos[0]!.at).toBe("selected");
    expect(look.decos[1]!.at).toEqual([0, 1, 2]);
  });
});

describe("mergeAgentLook", () => {
  it("appends decos and can clear", () => {
    const a = mergeAgentLook({ decos: [{ id: "a", kind: "photo", src: "/api/ai/assets/a", at: "origin" }] }, {
      decos: [{ id: "b", kind: "svg", src: "<svg></svg>", at: "internet" }],
      shader: "vec3 color(vec3 d, float t) { return uBg; }",
    });
    expect(a.decos.map((d) => d.id)).toEqual(["a", "b"]);
    expect(a.shader).toContain("color");
    expect(mergeAgentLook(a, { clear: true }).decos).toEqual([]);
  });
});

describe("decoHtml", () => {
  it("renders an img for photos", () => {
    expect(decoHtml({ id: "a", kind: "photo", src: "/api/ai/assets/x", at: "origin", label: "x" })).toContain("<img");
    expect(decoHtml({ id: "a", kind: "photo", src: "https://www.nasa.gov/a.jpg", at: "origin" }))
      .toContain("/api/sources/image?url=");
    expect(decoHtml({ id: "a", kind: "svg", src: "<svg viewBox='0 0 1 1'></svg>", at: "origin" })).toContain("<svg");
  });
});
