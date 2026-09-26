import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packMirrorPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "pack-mirror-gl.ts");

describe("pack mirror letterbox", () => {
  it("places letterbox inner viewport with bottom-left origin", () => {
    const src = readFileSync(packMirrorPath, "utf8");
    expect(src).toContain("const iy = dst.y + (dst.h - innerTd.y - innerTd.h);");
    expect(src).not.toContain("const iy = dst.y + innerTd.y;");
  });
});
