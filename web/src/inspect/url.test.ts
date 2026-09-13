import { describe, expect, it } from "vitest";
import { safeHttpUrl } from "./forensics";

describe("safeHttpUrl", () => {
  it("keeps http(s) and drops everything else", () => {
    expect(safeHttpUrl("https://192.168.86.20/")).toBe("https://192.168.86.20/");
    expect(safeHttpUrl("http://printer.local/ui")).toMatch(/^http:/);
    expect(safeHttpUrl("javascript:alert(1)")).toBeNull();
    expect(safeHttpUrl("file:///etc/passwd")).toBeNull();
    expect(safeHttpUrl("not a url")).toBeNull();
  });
});
