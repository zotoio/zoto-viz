import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FIELD_EDITED_ARIA,
  FIELD_EDITED_LABEL,
  askPluginReview,
  fillPluginFields,
} from "./plugin-ui";
import { configStoreId, fieldDefault, writePluginConfig } from "./plugin";
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

  it("renders a profile prompt textarea", () => {
    const host = document.createElement("div");
    fillPluginFields(host, { id: "cores", name: "CPU cores", version: 1, engine: "graph", base: "cores" }, [
      { key: "prompt", label: "prompt", type: "textarea", default: "", hint: "brief" },
    ], () => {});
    const ta = host.querySelector("textarea");
    expect(ta).toBeTruthy();
    expect(ta?.getAttribute("aria-label")).toBe("prompt");
    expect(host.textContent).toMatch(/prompt/);
  });

  it("skips the empty hint when more controls follow", () => {
    const host = document.createElement("div");
    fillPluginFields(host, { id: "pong", name: "Pong", version: 1, engine: "netpong" }, [], () => {}, { skipEmpty: true });
    expect(host.textContent).toMatch(/Pong/);
    expect(host.textContent).not.toMatch(/no extra settings/);
  });

  it("groups config fields by plugin.yml section and marks non-default values", () => {
    expect.hasAssertions();
    const host = document.createElement("div");
    const spec: PluginView = {
      id: "demo", name: "Demo", version: 1, engine: "graph",
      config: [
        { key: "a", label: "a", type: "number", default: 1, min: 0, max: 10, section: "Alpha" },
        { key: "b", label: "b", type: "boolean", default: false, section: "Beta" },
      ],
    };
    fillPluginFields(host, spec, spec.config!, () => {}, { skipEmpty: true });
    expect(host.querySelectorAll("details.sec-collapsible").length).toBe(2);
    localStorage.setItem("zoto-viz.plugin.demo.a", "3");
    const host2 = document.createElement("div");
    fillPluginFields(host2, spec, spec.config!, () => {}, { skipEmpty: true });
    expect(host2.querySelector(".field-dirty")).toBeTruthy();
    localStorage.removeItem("zoto-viz.plugin.demo.a");
  });

  function dirtySliderRow(spec: PluginView): { host: HTMLElement; range: HTMLInputElement; row: HTMLElement } {
    const host = document.createElement("div");
    fillPluginFields(host, spec, spec.config!, () => {}, { skipEmpty: true });
    const range = host.querySelector('input[type="range"]') as HTMLInputElement;
    const row = range.closest(".slider") as HTMLElement;
    range.value = "7";
    range.dispatchEvent(new Event("input", { bubbles: true }));
    return { host, range, row };
  }

  const gainSpec: PluginView = {
    id: "demo", name: "Demo", version: 1, engine: "graph",
    config: [{ key: "gain", label: "gain", type: "number", default: 3, min: 0, max: 10 }],
  };

  it("field edited visible label string", () => {
    expect.hasAssertions();
    const { row, range } = dirtySliderRow(gainSpec);
    expect(row.querySelector(".field-edited-cue")?.textContent).toBe(FIELD_EDITED_LABEL);
    expect(FIELD_EDITED_LABEL).toBe("Edited");
    range.value = "3";
    range.dispatchEvent(new Event("input", { bubbles: true }));
    expect(row.querySelector(".field-edited-cue")).toBeNull();
    writePluginConfig(configStoreId(gainSpec), { gain: "3" });
    const hostSaved = document.createElement("div");
    fillPluginFields(hostSaved, gainSpec, gainSpec.config!, () => {}, { skipEmpty: true });
    expect(hostSaved.querySelector(".field-edited-cue")).toBeNull();
  });

  it("dirty field-dirty styling selectors target slider and toggle roots", () => {
    expect.hasAssertions();
    const cssPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "../style.css");
    const css = readFileSync(cssPath, "utf8");
    expect(css).toMatch(/label\.slider\.field-dirty/);
    expect(css).toMatch(/label\.toggle\.field-dirty/);
    expect(css).not.toMatch(/\.field-dirty \.slider-row/);
  });

  it("marks dirty number sliders and boolean toggles with field-dirty", () => {
    expect.hasAssertions();
    const host = document.createElement("div");
    const spec: PluginView = {
      id: "demo", name: "Demo", version: 1, engine: "graph",
      config: [
        { key: "gain", label: "gain", type: "number", default: 3, min: 0, max: 10 },
        { key: "on", label: "on", type: "boolean", default: false },
      ],
    };
    fillPluginFields(host, spec, spec.config!, () => {}, { skipEmpty: true });
    const range = host.querySelector('input[type="range"]') as HTMLInputElement;
    const slider = range.closest("label.slider") as HTMLElement;
    range.value = "7";
    range.dispatchEvent(new Event("input", { bubbles: true }));
    expect(slider.classList.contains("field-dirty")).toBe(true);

    const toggleInput = host.querySelector("label.toggle input") as HTMLInputElement;
    const toggle = toggleInput.closest("label.toggle") as HTMLElement;
    toggleInput.checked = true;
    toggleInput.dispatchEvent(new Event("change", { bubbles: true }));
    expect(toggle.classList.contains("field-dirty")).toBe(true);
  });

  it("does not mark fields dirty while still at schema default", () => {
    expect.hasAssertions();
    const host = document.createElement("div");
    const spec: PluginView = {
      id: "clean-default", name: "Demo", version: 1, engine: "graph",
      config: [{ key: "gain", label: "gain", type: "number", default: 3, min: 0, max: 10 }],
    };
    localStorage.removeItem("zoto-viz.plugin.clean-default.gain");
    fillPluginFields(host, spec, spec.config!, () => {}, { skipEmpty: true });
    const slider = host.querySelector("label.slider") as HTMLElement;
    expect(slider.classList.contains("field-dirty")).toBe(false);
  });

  it("leaves unsectioned-only knobs in a flat sec, not collapsible details", () => {
    expect.hasAssertions();
    const host = document.createElement("div");
    const spec: PluginView = {
      id: "demo", name: "Demo", version: 1, engine: "graph",
      config: [{ key: "on", label: "on", type: "boolean", default: false }],
    };
    fillPluginFields(host, spec, spec.config!, () => {}, { skipEmpty: true });
    expect(host.querySelector("details.sec-collapsible")).toBeNull();
    expect(host.querySelector(".sec-controls")).toBeTruthy();
  });

  it("field unsaved change aria description string", () => {
    expect.hasAssertions();
    const { row, range } = dirtySliderRow(gainSpec);
    expect(row.getAttribute("aria-description")).toBe(FIELD_EDITED_ARIA);
    expect(FIELD_EDITED_ARIA).toBe("Unsaved change");
    range.value = "3";
    range.dispatchEvent(new Event("input", { bubbles: true }));
    expect(row.getAttribute("aria-description")).toBeNull();
    writePluginConfig(configStoreId(gainSpec), { gain: "3" });
    const hostSaved = document.createElement("div");
    fillPluginFields(hostSaved, gainSpec, gainSpec.config!, () => {}, { skipEmpty: true });
    const rowSaved = hostSaved.querySelector(".slider") as HTMLElement;
    expect(rowSaved.getAttribute("aria-description")).toBeNull();
  });

  it("renders nest-cams layout and camera chips instead of a pane slider", () => {
    const host = document.createElement("div");
    fillPluginFields(host, { id: "nest-cams", name: "Nest cams", version: 1, engine: "graph" }, [
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
      id: "pulse", name: "Pulse", version: 1, engine: "graph", runtime: "typescript",
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
