import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SERVER_RESTART_NOTICE } from "../core/http-copy";

const mainPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "main.ts");

describe("main entry wiring", () => {
  beforeEach(() => {
    expect.hasAssertions();
    document.body.innerHTML = "<div id=\"wall\"></div>";
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("binds server restart wall notice from the production entry module", () => {
    const mainSrc = readFileSync(mainPath, "utf8");
    expect(mainSrc).toContain("bindServerRestartWallNotice();");
    expect(mainSrc).toMatch(/bindServerRestartWallNotice\(\);\s*\nconnect\(\);/);
    expect(SERVER_RESTART_NOTICE).toBe("The server restarted, so packs were reloaded.");
  });
});
