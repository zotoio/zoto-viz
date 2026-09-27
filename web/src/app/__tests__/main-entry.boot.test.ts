/** @vitest-environment happy-dom */
import { describe, expect, it } from "vitest";
import { bootMainEntry, waitEntryBootComplete } from "./main-entry-harness";

describe("main.ts production entry async boot", () => {
  it("finishes async boot and writes session live state", async () => {
    expect.hasAssertions();
    await bootMainEntry();
    await waitEntryBootComplete();
    expect(document.querySelector("#wall canvas.render-host")).toBeTruthy();
    expect(document.body.classList.contains("view-booting")).toBe(false);
  });
});
