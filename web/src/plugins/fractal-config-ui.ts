import {
  fractalPresetConfig,
  fractalRandomConfig,
} from "../../../plugins/src/fractal-zoom/frontend/config-mutation";
import type { PluginView } from "./plugin";

const undoKey = (id: string) => `zoto-viz.plugin.${id}.__undo`;

/** Preset / randomise / undo / reset — host persists config; pack reads via config.read only. */
export function applyFractalConfigActions(
  spec: PluginView,
  values: Record<string, string>,
): boolean {
  if (spec.id !== "fractal-zoom") return false;
  let changed = false;

  if (values.resetPreset === "go") {
    const preset = values.preset ?? "bulb-classic";
    Object.assign(values, fractalPresetConfig(preset), { resetPreset: "hold", undo: "hold", randomise: "hold" });
    changed = true;
  }

  if (values.randomise === "roll") {
    localStorage.setItem(undoKey(spec.id), JSON.stringify({ ...values }));
    Object.assign(values, fractalRandomConfig(Math.random()), {
      preset: "custom",
      randomise: "hold",
      undo: "hold",
      resetPreset: "hold",
    });
    changed = true;
  }

  if (values.undo === "go") {
    const raw = localStorage.getItem(undoKey(spec.id));
    if (raw) {
      try {
        Object.assign(values, JSON.parse(raw) as Record<string, string>, { undo: "hold", randomise: "hold", resetPreset: "hold" });
        changed = true;
      } catch { /* ignore */ }
    } else {
      values.undo = "hold";
    }
  }

  if (values.preset && values.preset !== "custom" && values.randomise === "hold" && values.resetPreset === "hold") {
    // baseline sync when user picks a new preset from the picker
  }

  return changed;
}

export function fractalFieldBaseline(values: Record<string, string>, key: string): string | undefined {
  const preset = values.preset ?? "bulb-classic";
  if (preset === "custom") return undefined;
  const base = fractalPresetConfig(preset);
  return base[key];
}
