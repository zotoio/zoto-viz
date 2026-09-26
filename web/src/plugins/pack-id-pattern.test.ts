import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PACK_ID_PATTERN } from "../../../plugins/sdk/pack-id-pattern";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("pack id pattern", () => {
  it("matches schema/plugin.schema.json properties.id.pattern", () => {
    const schema = JSON.parse(
      readFileSync(path.join(repoRoot, "schema/plugin.schema.json"), "utf8"),
    ) as { properties?: { id?: { pattern?: string } } };
    expect(PACK_ID_PATTERN.source).toBe(schema.properties?.id?.pattern);
  });
});
