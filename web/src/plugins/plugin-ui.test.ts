import { describe, expect, it } from "vitest";
import { askPluginReview, fillPluginFields } from "./plugin-ui";
import { fieldDefault } from "./plugin";
import type { PluginView } from "./plugin";

describe("fillPluginFields", () => {
  it("renders an empty plugin and typed fields", () => {
    const host = document.createElement("div");
    fillPluginFields(host, { id: "empty", name: "Empty", version: 1, engine: "graph" }, [], () => {});
    expect(host.textContent).toMatch(/no extra settings/);

    const spec: PluginView = {
      id: "pulse", name: "Pulse", version: 2, engine: "graph", base: "topology", hint: "demo",
      config: [
        { key: "on", label: "on", type: "boolean", default: true },
        { key: "mode", label: "mode", type: "select", values: [["a", "A"], ["b", "B"]], default: "a" },
        { key: "gain", label: "gain", type: "number", min: 0, max: 10, default: 3 },
        { key: "note", label: "note", type: "text", default: "hi" },
      ],
    };
    const host2 = document.createElement("div");
    const seen: Record<string, string>[] = [];
    fillPluginFields(host2, spec, spec.config!, (_id, values) => seen.push({ ...values }));
    expect(host2.querySelector(".sec-title")?.textContent).toBe("NET Pulse");
    expect(host2.querySelector(".toggle")).toBeTruthy();
    expect(host2.querySelector(".select")).toBeTruthy();
    expect(host2.querySelector(".slider")).toBeTruthy();
    expect(host2.querySelector(".text")).toBeTruthy();
    expect(fieldDefault(spec.config![0]!)).toBe("1");
  });

  it("asks the operator to examine plugin source", async () => {
    const pending = askPluginReview({
      id: "pulse", name: "Pulse", version: 1, engine: "graph", runtime: "typescript",
      service: "service/__init__.py", file: "/tmp/pulse-ts/plugin.yml",
    });
    expect(document.body.classList.contains("modal-open")).toBe(true);
    expect(document.body.textContent).toMatch(/AI IDE/);
    expect(document.body.textContent).toMatch(/Cursor/);
    expect(document.body.textContent).toMatch(/service\/\*\.py/);
    const examined = [...document.querySelectorAll("button")].find((b) => b.textContent === "I examined the source");
    examined!.click();
    await expect(pending).resolves.toBe("reviewed");
    expect(document.body.classList.contains("modal-open")).toBe(false);
  });

  it("can cancel or claim authorship", async () => {
    const first = askPluginReview({ id: "x", name: "X", version: 1, engine: "graph", runtime: "typescript" });
    [...document.querySelectorAll("button")].find((b) => b.textContent === "Not now")!.click();
    await expect(first).resolves.toBeNull();

    const second = askPluginReview({ id: "y", name: "Y", version: 1, engine: "graph", service: "service.py" });
    [...document.querySelectorAll("button")].find((b) => b.textContent === "I wrote this")!.click();
    await expect(second).resolves.toBe("authored");

    const third = askPluginReview({ id: "z", name: "Z", version: 1, engine: "graph", runtime: "typescript" });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await expect(third).resolves.toBeNull();
  });
});
