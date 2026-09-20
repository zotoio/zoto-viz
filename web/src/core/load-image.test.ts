import { describe, expect, it } from "vitest";
import { imageIsReady, loadHtmlImage, retrySrc, stillSrc } from "./load-image";

describe("stillSrc", () => {
  it("proxies https through the monitor", () => {
    expect(stillSrc("https://www.nasa.gov/a.jpg")).toBe(
      "/api/sources/image?url=https%3A%2F%2Fwww.nasa.gov%2Fa.jpg",
    );
  });

  it("keeps same-origin and data URLs", () => {
    expect(stillSrc("/api/ai/assets/abc")).toBe("/api/ai/assets/abc");
    expect(stillSrc("/skies/reef.jpg")).toBe("/skies/reef.jpg");
    expect(stillSrc("data:image/png;base64,xx")).toBe("data:image/png;base64,xx");
  });

  it("drops javascript and empty", () => {
    expect(stillSrc("javascript:alert(1)")).toBe("");
    expect(stillSrc("")).toBe("");
    expect(stillSrc("http://insecure.example/a.jpg")).toBe("");
  });
});

describe("retrySrc", () => {
  it("adds a cache-bust query after the first try", () => {
    expect(retrySrc("/api/x", 0)).toBe("/api/x");
    expect(retrySrc("/api/x", 1)).toBe("/api/x?_try=1");
    expect(retrySrc("/api/x?url=a", 2)).toBe("/api/x?url=a&_try=2");
  });
});

describe("imageIsReady", () => {
  it("needs a decoded width", () => {
    const el = { complete: true, naturalWidth: 0 } as HTMLImageElement;
    expect(imageIsReady(el)).toBe(false);
    expect(imageIsReady({ complete: true, naturalWidth: 12 } as HTMLImageElement)).toBe(true);
  });
});

describe("loadHtmlImage", () => {
  it("retries then decodes", async () => {
    let n = 0;
    let src = "";
    const el: {
      complete: boolean;
      naturalWidth: number;
      decoding: string;
      getAttribute: (name: string) => string | null;
      src: string;
      onload: ((ev: Event) => void) | null;
      onerror: ((ev: Event) => void) | null;
      decode: () => Promise<void>;
    } = {
      complete: false,
      naturalWidth: 0,
      decoding: "auto",
      getAttribute(name: string) {
        return name === "src" ? src : null;
      },
      set src(v: string) {
        src = v;
        n += 1;
        queueMicrotask(() => {
          if (n < 2) {
            el.complete = true;
            el.naturalWidth = 0;
            el.onerror?.(new Event("error"));
            return;
          }
          el.complete = true;
          el.naturalWidth = 16;
          el.onload?.(new Event("load"));
        });
      },
      get src() {
        return src;
      },
      onload: null,
      onerror: null,
      async decode() {},
    };
    const got = await loadHtmlImage(el as unknown as HTMLImageElement, "/api/ai/assets/x", { retryMs: 0, timeoutMs: 2000 });
    expect(got.naturalWidth).toBe(16);
    expect(n).toBe(2);
  });
});
