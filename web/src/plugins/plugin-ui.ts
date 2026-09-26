import { configStoreId, fieldDefault, loadPluginConfig, specCaption, writePluginConfig, type PluginView } from "./plugin";
import type { PluginField } from "../core/modes";
import { Select, Slider, TextField, Toggle } from "../ui/ui";
import { mountNestCamFields } from "./nest-cams-ui";
import type { SdmDevice } from "./nest-cams-look";
import {
  applyPresetToValues,
  buildPluginHudCaption,
  fieldBaselineForDirty,
  hasDeclaredSettings,
  markPresetConsistency,
  orderedSectionTitles,
  packConfigValues,
  popUndoSnapshot,
  pushUndoSnapshot,
  randomiseDeclaredConfig,
  rememberSectionOpen,
  resetDeclaredConfig,
  sectionOpenState,
} from "./plugin-settings";

export type PluginHudCaptionSink = (caption: string | null) => void;

let hudCaptionSink: PluginHudCaptionSink | null = null;

export function setPluginHudCaptionSink(sink: PluginHudCaptionSink | null): void {
  hudCaptionSink = sink;
}

export function refreshPluginHudCaption(
  spec: PluginView,
  fields: PluginField[],
  values: Record<string, string>,
): void {
  hudCaptionSink?.(buildPluginHudCaption(spec, fields, values));
}

function appendFieldControl(
  row: HTMLElement,
  f: PluginField,
  values: Record<string, string>,
  spec: PluginView,
  fields: PluginField[],
  persist: () => void,
  remount: () => void,
): void {
  const current = values[f.key] ?? fieldDefault(f);
  const baseline = fieldBaselineForDirty(spec, fields, values, f.key);
  const dirty = baseline !== undefined && String(current) !== String(baseline);
  const wrap = (el: HTMLElement) => {
    if (dirty) el.classList.add("field-dirty");
    el.setAttribute("data-field-key", f.key);
    row.append(el);
  };
  const pf = spec.settings?.presetField;
  if (f.type === "boolean") {
    const t = new Toggle({
      label: f.label,
      title: f.hint,
      checked: current === "1" || current === "true",
      onChange: (on) => { values[f.key] = on ? "1" : "0"; persist(); },
    });
    wrap(t.el);
  } else if (f.type === "select" && f.values?.length) {
    const s = new Select({
      caption: f.label,
      title: f.hint,
      options: f.values.map(([value, label]) => ({ value, label })),
      value: current,
      onChange: (v) => {
        values[f.key] = v;
        if (pf && f.key === pf && v !== "custom" && spec.settings?.presets?.some((p) => p.id === v)) {
          pushUndoSnapshot(configStoreId(spec, spec.configViewId), { ...values });
          applyPresetToValues(spec, fields, values, v);
          persist();
          remount();
          return;
        }
        persist();
      },
    });
    wrap(s.el);
  } else if (f.type === "number") {
    const min = f.min ?? 0;
    const max = f.max ?? Math.max(min + 1, 100);
    const sl = new Slider({
      label: f.label,
      title: f.hint,
      min,
      max,
      step: f.step ?? 1,
      value: Number(current),
      onInput: (v) => { values[f.key] = String(v); persist(); },
    });
    wrap(sl.el);
  } else {
    const tf = new TextField({
      caption: f.label,
      title: f.hint,
      placeholder: f.default !== undefined ? String(f.default) : undefined,
      value: current,
      onInput: (v) => { values[f.key] = v; persist(); },
    });
    wrap(tf.el);
  }
}

function mountSettingsToolbar(
  host: HTMLElement,
  spec: PluginView,
  fields: PluginField[],
  values: Record<string, string>,
  persist: () => void,
  remount: () => void,
): void {
  const decl = spec.settings;
  if (!decl?.presets?.length) return;
  const storeId = configStoreId(spec, spec.configViewId);
  const row = document.createElement("div");
  row.className = "sec plugin-settings-toolbar";
  row.setAttribute("role", "toolbar");
  row.setAttribute("aria-label", "Preset tools");
  const controls = document.createElement("div");
  controls.className = "sec-controls plugin-settings-toolbar-row";

  const pf = decl.presetField ?? "preset";
  const presetField = fields.find((f) => f.key === pf);
  const presetIds = new Set(decl.presets.map((p) => p.id));
  const options = [
    ...decl.presets.map((p) => ({ value: p.id, label: p.label })),
    { value: "custom", label: "Custom" },
  ];
  const cur = values[pf] ?? decl.presets[0]?.id ?? "custom";
  const presetSel = new Select({
    caption: presetField?.label ?? "preset",
    title: presetField?.hint ?? "Named starting points",
    options,
    value: presetIds.has(cur) || cur === "custom" ? cur : "custom",
    onChange: (v) => {
      if (v === "custom") {
        values[pf] = "custom";
        persist();
        remount();
        return;
      }
      pushUndoSnapshot(storeId, { ...values });
      applyPresetToValues(spec, fields, values, v);
      persist();
      remount();
    },
  });
  controls.append(presetSel.el);

  const mkBtn = (label: string, title: string, onClick: () => void) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "btn";
    b.textContent = label;
    b.title = title;
    b.addEventListener("click", onClick);
    return b;
  };

  controls.append(
    mkBtn("Randomise", "Randomise fields (respects randomRange and randomise:false)", () => {
      pushUndoSnapshot(storeId, { ...values });
      randomiseDeclaredConfig(spec, fields, values, Math.random);
      persist();
      remount();
    }),
    mkBtn("Undo", "Undo last bulk change", () => {
      const snap = popUndoSnapshot(storeId);
      if (!snap) return;
      Object.assign(values, snap);
      persist();
      remount();
    }),
    mkBtn("Reset", "Reset to active preset or defaults", () => {
      pushUndoSnapshot(storeId, { ...values });
      resetDeclaredConfig(spec, fields, values);
      persist();
      remount();
    }),
  );
  row.append(controls);
  host.append(row);
}

function mountSectionedFields(
  host: HTMLElement,
  spec: PluginView,
  compact: PluginField[],
  values: Record<string, string>,
  fields: PluginField[],
  persist: () => void,
  remount: () => void,
): void {
  const storeId = configStoreId(spec, spec.configViewId);
  const sectionDecl = spec.settings?.sections ?? [];
  const titles = orderedSectionTitles(spec, compact);
  const pf = spec.settings?.presetField;
  const bySection = new Map<string, PluginField[]>();
  for (const f of compact) {
    if (pf && f.key === pf && spec.settings?.presets?.length) continue;
    const t = f.section ?? "";
    if (!bySection.has(t)) bySection.set(t, []);
    bySection.get(t)!.push(f);
  }
  titles.forEach((title, index) => {
    const sectionFields = bySection.get(title);
    if (!sectionFields?.length) return;
    const open = sectionOpenState(storeId, title, sectionDecl, index);
    const container = title
      ? document.createElement("details")
      : document.createElement("div");
    if (container instanceof HTMLDetailsElement) {
      container.className = "sec sec-collapsible";
      container.open = open;
      const sum = document.createElement("summary");
      sum.className = "sec-title";
      sum.textContent = title;
      container.append(sum);
      container.addEventListener("toggle", () => {
        rememberSectionOpen(storeId, title, container.open);
      });
    } else {
      container.className = "sec";
    }
    const row = document.createElement("div");
    row.className = "sec-controls";
    for (const f of sectionFields) appendFieldControl(row, f, values, spec, fields, persist, remount);
    container.append(row);
    host.append(container);
  });
}

export function fillPluginFields(
  host: HTMLElement,
  spec: PluginView,
  fields: PluginField[],
  onPersist: (id: string, values: Record<string, string>) => void,
  opts?: { skipEmpty?: boolean; devices?: SdmDevice[] },
): void {
  const values = loadPluginConfig(spec, fields);
  if (hasDeclaredSettings(spec)) markPresetConsistency(spec, fields, values);
  const head = document.createElement("div");
  head.className = "sec";
  const title = document.createElement("div");
  title.className = "sec-title";
  title.textContent = specCaption(spec);
  const meta = document.createElement("div");
  meta.className = "sec-hint";
  meta.textContent = `${spec.id} · v${spec.version} · ${spec.engine ?? "yaml"}${spec.base ? ` / ${spec.base}` : ""}${spec.hint ? `. ${spec.hint}` : ""}`;
  head.append(title, meta);
  let knobs = fields;
  if (spec.id === "nest-cams") {
    knobs = mountNestCamFields(host, spec, fields, values, opts?.devices ?? [], onPersist);
  } else {
    host.append(head);
  }
  if (!knobs.length) {
    if (!opts?.skipEmpty && spec.id !== "nest-cams") {
      const empty = document.createElement("div");
      empty.className = "sec";
      empty.innerHTML = `<div class="sec-hint">This plugin has no extra settings.</div>`;
      host.append(empty);
    }
    return;
  }
  const remount = () => {
    host.replaceChildren();
    fillPluginFields(host, spec, fields, onPersist, opts);
  };
  const persist = () => {
    markPresetConsistency(spec, fields, values);
    const storeId = configStoreId(spec, spec.configViewId);
    writePluginConfig(storeId, values);
    onPersist(storeId, packConfigValues(values));
    refreshPluginHudCaption(spec, fields, values);
  };
  const compact: PluginField[] = [];
  const notes: PluginField[] = [];
  for (const f of knobs) {
    if (f.type === "textarea") notes.push(f);
    else compact.push(f);
  }
  if (hasDeclaredSettings(spec)) {
    mountSettingsToolbar(host, spec, fields, values, persist, remount);
    mountSectionedFields(host, spec, compact, values, fields, persist, remount);
  } else if (compact.length) {
    const sec = document.createElement("div");
    sec.className = "sec";
    const row = document.createElement("div");
    row.className = "sec-controls";
    for (const f of compact) appendFieldControl(row, f, values, spec, fields, persist, remount);
    sec.append(row);
    host.append(sec);
  }
  for (const f of notes) {
    const current = values[f.key] ?? fieldDefault(f);
    const wrap = document.createElement("div");
    wrap.className = "sec view-prompt";
    const cap = document.createElement("label");
    cap.className = "cap";
    cap.textContent = f.label;
    if (f.hint) {
      wrap.title = f.hint;
      cap.title = f.hint;
    }
    const ta = document.createElement("textarea");
    ta.rows = 3;
    ta.spellcheck = false;
    ta.setAttribute("autocomplete", "off");
    ta.setAttribute("aria-label", f.label);
    if (f.hint) ta.placeholder = f.hint;
    ta.value = current;
    ta.addEventListener("input", () => { values[f.key] = ta.value; persist(); });
    wrap.append(cap, ta);
    host.append(wrap);
  }
  refreshPluginHudCaption(spec, fields, values);
}

/** Modal: the operator wrote this plugin, or they examined the source (AI IDE suggested). */
export function askPluginReview(spec: PluginView): Promise<"reviewed" | "authored" | null> {
  return new Promise((resolve) => {
    const bits: string[] = [];
    if (spec.runtime === "typescript" || spec.has_frontend) bits.push("sandboxed TypeScript");
    if (spec.service) bits.push("a Python module loaded into the monitor process");
    if (spec.has_sky_shader || spec.shader_sha256) bits.push("a custom GLSL sky shader");
    const what = bits.join(" and ") || "executable code";

    const modal = document.createElement("div");
    modal.className = "modal ask";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    const back = document.createElement("div");
    back.className = "backdrop";
    const sheet = document.createElement("div");
    sheet.className = "sheet";
    const head = document.createElement("div");
    head.className = "mhead";
    const h = document.createElement("strong");
    h.textContent = `Review “${spec.name}” before activating`;
    head.appendChild(h);
    const body = document.createElement("div");
    body.className = "ask-body";
    const p1 = document.createElement("p");
    p1.textContent = `This plugin ships ${what}. That is not the same as a YAML look overlay — it can change how the monitor or graph behaves.`;
    const p2 = document.createElement("p");
    p2.textContent = "If you did not write it, examine the source for security issues before continuing. Open the plugin folder in an AI IDE (for example Cursor) and ask it to review the TypeScript, any service/*.py files, and sky/fragment.glsl.";
    const p3 = document.createElement("p");
    p3.className = "muted";
    p3.textContent = spec.file ? `Source: ${spec.file}` : `id ${spec.id} · v${spec.version}`;
    body.append(p1, p2, p3);
    const row = document.createElement("div");
    row.className = "ask-actions";
    const finish = (kind: "reviewed" | "authored" | null) => {
      document.body.classList.remove("modal-open");
      modal.remove();
      document.removeEventListener("keydown", onKey, true);
      resolve(kind);
    };
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "btn";
    cancel.textContent = "Not now";
    cancel.addEventListener("click", () => finish(null));
    const wrote = document.createElement("button");
    wrote.type = "button";
    wrote.className = "btn";
    wrote.textContent = "I wrote this";
    wrote.addEventListener("click", () => finish("authored"));
    const reviewed = document.createElement("button");
    reviewed.type = "button";
    reviewed.className = "btn primary";
    reviewed.textContent = "I examined the source";
    reviewed.addEventListener("click", () => finish("reviewed"));
    row.append(cancel, wrote, reviewed);
    sheet.append(head, body, row);
    modal.append(back, sheet);
    back.addEventListener("click", () => finish(null));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); finish(null); }
    };
    document.addEventListener("keydown", onKey, true);
    document.body.classList.add("modal-open");
    document.body.appendChild(modal);
    reviewed.focus();
  });
}
