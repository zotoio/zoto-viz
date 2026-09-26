import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "vitest";
import { buildCollectEquivalenceFixture } from "./viz-collect-equivalence-fixture";

const dir = path.dirname(fileURLToPath(import.meta.url));

describe("viz collect equivalence fixture freeze", () => {
  it("writes the 600-frame collector output fixture", () => {
    if (!process.env.FREEZE_COLLECT_EQUIVALENCE) return;
    const fixture = buildCollectEquivalenceFixture();
    writeFileSync(
      path.join(dir, "viz-collect-equivalence-600.json"),
      `${JSON.stringify(fixture, null, 2)}\n`,
    );
  });
});
