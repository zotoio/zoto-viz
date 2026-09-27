import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const renderHostPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "render-host.ts");

describe("sandbox bitmap close order", () => {
  it("closes bitmap only after presentBitmapMirror draws", () => {
    const src = readFileSync(renderHostPath, "utf8");
    const present = src.indexOf("gpu.present(rd, tex, fill, dst, aspect)");
    const close = src.indexOf("bitmap.close()");
    expect(present).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(present);
  });
});
