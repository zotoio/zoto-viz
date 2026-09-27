import { describe, expect, it } from "vitest";
import { askPluginReview, fillPluginFields } from "./plugin-ui";
import { fieldDefault } from "./plugin";
import type { PluginView } from "./plugin";

describe("fillPluginFields", () => {
  it("renders an empty plugin and typed fields", () => {
    const host = document.createElement("div");
    fillPluginFields(host, { id: "empty", packName: "Empty", version: 1, engine: "graph" }, [], () => {});
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

  it("renders a profile prompt textarea", () => {
    const host = document.createElement("div");
    fillPluginFields(host, { id: "cores", packName: "CPU cores", version: 1, engine: "graph", base: "cores" }, [
      { key: "prompt", label: "prompt", type: "textarea", default: "", hint: "brief" },
    ], () => {});
    const ta = host.querySelector("textarea");
    expect(ta).toBeTruthy();
    expect(ta?.getAttribute("aria-label")).toBe("prompt");
    expect(host.textContent).toMatch(/prompt/);
  });

  it("skips the empty hint when more controls follow", () => {
    const host = document.createElement("div");
    fillPluginFields(host, { id: "pong", packName: "Pong", version: 1, engine: "netpong" }, [], () => {}, { skipEmpty: true });
    expect(host.textContent).toMatch(/Pong/);
    expect(host.textContent).not.toMatch(/no extra settings/);
  });

  it("renders nest-cams layout and camera chips instead of a pane slider", () => {
    const host = document.createElement("div");
    fillPluginFields(host, { id: "nest-cams", packName: "Nest cams", version: 1, engine: "graph" }, [
      { key: "live", label: "live stream", type: "boolean", default: true },
      { key: "stills", label: "motion stills", type: "boolean", default: false },
      { key: "grid", label: "layout", type: "select", values: [["auto", "all"], ["4", "2×2"]], default: "auto" },
      { key: "pick", label: "cameras", type: "text", default: "" },
      { key: "prompt", label: "prompt", type: "textarea", default: "" },
    ], () => {}, { devices: [{ id: "a", label: "Office", type: "camera", camera: true }] });
    expect(host.textContent).toMatch(/layout/);
    expect(host.textContent).toMatch(/cameras/);
    expect(host.textContent).toMatch(/Office/);
    expect(host.textContent).toMatch(/show/);
    expect([...host.querySelectorAll("button")].map((b) => b.textContent)).toEqual(
      expect.arrayContaining(["live", "stills", "all", "Office"]),
    );
    expect(host.querySelector(".slider")).toBeNull();
    expect(host.querySelector(".toggle")).toBeNull();
    expect(host.querySelector("textarea")).toBeTruthy();
  });

  it("asks the operator to examine plugin source", async () => {
    const pending = askPluginReview({
      id: "pulse", packName: "Pulse", version: 1, engine: "graph", runtime: "typescript",
      service: "service/__init__.py", file: "/tmp/pulse-ts/plugin.yml",
    });
    expect(document.body.classList.contains("modal-open")).toBe(true);
    expect(document.body.textContent).toMatch(/AI IDE/);
    expect(document.body.textContent).toMatch(/Cursor/);
    expect(document.body.textContent).toMatch(/service\/\*\.py/);
    expect(document.body.textContent).toMatch(/fragment\.glsl/);
    const examined = [...document.querySelectorAll("button")].find((b) => b.textContent === "I examined the source");
    examined!.click();
    await expect(pending).resolves.toBe("reviewed");
    expect(document.body.classList.contains("modal-open")).toBe(false);
  });

  it("can cancel or claim authorship", async () => {
    const first = askPluginReview({ id: "x", packName: "X", version: 1, engine: "graph", runtime: "typescript" });
    [...document.querySelectorAll("button")].find((b) => b.textContent === "Not now")!.click();
    await expect(first).resolves.toBeNull();

    const second = askPluginReview({ id: "y", packName: "Y", version: 1, engine: "graph", service: "service.py" });
    [...document.querySelectorAll("button")].find((b) => b.textContent === "I wrote this")!.click();
    await expect(second).resolves.toBe("authored");

    const third = askPluginReview({ id: "z", packName: "Z", version: 1, engine: "graph", runtime: "typescript" });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await expect(third).resolves.toBeNull();
  });
});
