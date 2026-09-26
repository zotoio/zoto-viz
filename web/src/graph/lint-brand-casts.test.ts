import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("lint brand casts", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  it("passes on the production tree", () => {
    execFileSync("pnpm", ["lint"], { cwd: webRoot, stdio: "pipe" });
    expect(true).toBe(true);
  });
});
