import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { buildCollectEquivalenceFixture } from "./viz-collect-equivalence-fixture";

const dir = path.dirname(fileURLToPath(import.meta.url));

describe("viz collect equivalence fixture freeze", () => {
  beforeEach(() => expect.hasAssertions());

  it.skipIf(!process.env.FREEZE_COLLECT_EQUIVALENCE)("writes the 600-frame collector output fixture", () => {
    const fixture = buildCollectEquivalenceFixture();
    const body = fixture.map((frame) => JSON.stringify(frame)).join("\n");
    writeFileSync(path.join(dir, "viz-collect-equivalence-600.jsonl"), `${body}\n`);
  });
});
