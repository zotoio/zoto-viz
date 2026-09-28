import type { PluginView } from "../plugins/plugin";
import { Select } from "../ui/ui";
import {
  listDataSourcePlugins,
  listRemixVisualPacks,
  sourceOptionsForPlugin,
  type DataSourcePluginView,
} from "./data-source-catalog";
import type { RemixPairing } from "./remix-types";
import { loadRemixPairing } from "./remix-store";

export interface RemixPickerModel {
  dataPlugins: DataSourcePluginView[];
  visualPacks: PluginView[];
  pairing: RemixPairing | null;
}

export function buildRemixPickerModel(specs: PluginView[]): RemixPickerModel {
  return {
    dataPlugins: listDataSourcePlugins(specs),
    visualPacks: listRemixVisualPacks(specs),
    pairing: loadRemixPairing(),
  };
}

export interface RemixPickerControls {
  root: HTMLElement;
  dataSelect: Select;
  sourceSelect: Select;
  packSelect: Select;
  status: HTMLDivElement;
  saveBtn: HTMLButtonElement;
  clearBtn: HTMLButtonElement;
  syncSources: () => void;
  currentPairing: () => RemixPairing | null;
}

export function mountRemixPicker(
  host: HTMLElement,
  model: RemixPickerModel,
  onSave: (pairing: RemixPairing) => void,
  onClear: () => void,
): RemixPickerControls {
  const sec = document.createElement("section");
  sec.className = "sec remix-picker";
  sec.innerHTML = `<div class="sec-title">Remix</div>
    <div class="sec-hint">Pair a public data-source demo snapshot with a viz pack. Live fetching is not wired yet — demo JSON only.</div>`;

  const dataSelect = new Select({
    caption: "data source",
    options: model.dataPlugins.map((p) => ({
      value: p.id,
      label: p.name,
      hint: p.id,
    })),
    value: model.pairing?.dataPluginId ?? model.dataPlugins[0]?.id ?? "",
  });

  const initialSources = sourceOptionsForPlugin(model.dataPlugins, dataSelect.value);
  const sourceSelect = new Select({
    caption: "source",
    options: initialSources.map((s) => ({
      value: s.id,
      label: s.id,
      hint: `${s.outputShape} · ${s.refreshSec}s`,
    })),
    value: model.pairing?.sourceId ?? initialSources[0]?.id ?? "",
  });

  const packSelect = new Select({
    caption: "visual pack",
    options: model.visualPacks.map((p) => ({
      value: p.id,
      label: p.name,
      hint: p.id,
    })),
    value: model.pairing?.visualPackId ?? model.visualPacks[0]?.id ?? "",
  });

  const status = document.createElement("div");
  status.className = "sec-hint remix-picker-status";
  status.setAttribute("aria-live", "polite");

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "btn";
  saveBtn.textContent = "Save remix pairing";

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "btn ghost";
  clearBtn.textContent = "Clear remix";

  const row = document.createElement("div");
  row.className = "sec-controls";
  row.append(saveBtn, clearBtn);

  const syncSources = (): void => {
    const sources = sourceOptionsForPlugin(model.dataPlugins, dataSelect.value);
    sourceSelect.setOptions(sources.map((s) => ({
      value: s.id,
      label: s.id,
      hint: `${s.outputShape} · ${s.refreshSec}s`,
    })));
    if (!sources.some((s) => s.id === sourceSelect.value)) {
      sourceSelect.value = sources[0]?.id ?? "";
    }
  };

  dataSelect.onChange = () => syncSources();

  saveBtn.addEventListener("click", () => {
    const dataPluginId = dataSelect.value;
    const sourceId = sourceSelect.value;
    const visualPackId = packSelect.value;
    if (!dataPluginId || !sourceId || !visualPackId) {
      status.textContent = "Choose a data source, source row, and visual pack.";
      return;
    }
    const pairing: RemixPairing = { dataPluginId, sourceId, visualPackId };
    onSave(pairing);
    status.textContent = `Saved remix: ${dataPluginId}/${sourceId} → ${visualPackId}`;
  });

  clearBtn.addEventListener("click", () => {
    onClear();
    status.textContent = "Remix cleared.";
  });

  sec.append(dataSelect.el, sourceSelect.el, packSelect.el, status, row);
  host.appendChild(sec);

  if (model.pairing) {
    status.textContent = `Active remix: ${model.pairing.dataPluginId}/${model.pairing.sourceId} → ${model.pairing.visualPackId}`;
  }

  return {
    root: sec,
    dataSelect,
    sourceSelect,
    packSelect,
    status,
    saveBtn,
    clearBtn,
    syncSources,
    currentPairing: () => {
      const dataPluginId = dataSelect.value;
      const sourceId = sourceSelect.value;
      const visualPackId = packSelect.value;
      if (!dataPluginId || !sourceId || !visualPackId) return null;
      return { dataPluginId, sourceId, visualPackId };
    },
  };
}
