import { configStoreId, fieldDefault, loadPluginConfig, specCaption, writePluginConfig, type PluginView } from "./plugin";
import { packScopeNoteText, type PackWallScope } from "./instances";
import { recordPackScopeNoteTextWrite } from "./pack-scope-note-metrics";
import type { PluginField } from "../core/modes";
import { Select, Slider, TextField, Toggle } from "../ui/ui";
import { mountNestCamFields } from "./nest-cams-ui";
import type { SdmDevice } from "./nest-cams-look";

export function fillPluginFields(
  host: HTMLElement,
  spec: PluginView,
  fields: PluginField[],
  onPersist: (id: string, values: Record<string, string>) => void,
  opts?: { skipEmpty?: boolean; devices?: SdmDevice[]; wallScope?: PackWallScope },
): void {
  const values = loadPluginConfig(spec, fields);
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
    mountPackScopeNote(host, spec, opts?.wallScope);
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
  const persist = () => {
    writePluginConfig(configStoreId(spec), values);
    onPersist(configStoreId(spec), values);
  };
  const compact: PluginField[] = [];
  const notes: PluginField[] = [];
  for (const f of knobs) {
    if (f.type === "textarea") notes.push(f);
    else compact.push(f);
  }
  if (compact.length) {
    const sec = document.createElement("div");
    sec.className = "sec";
    const row = document.createElement("div");
    row.className = "sec-controls";
    for (const f of compact) {
      const current = values[f.key] ?? fieldDefault(f);
      if (f.type === "boolean") {
        const t = new Toggle({
          label: f.label,
          title: f.hint,
          checked: current === "1" || current === "true",
          onChange: (on) => { values[f.key] = on ? "1" : "0"; persist(); },
        });
        row.append(t.el);
      } else if (f.type === "select" && f.values?.length) {
        const s = new Select({
          caption: f.label,
          title: f.hint,
          options: f.values.map(([value, label]) => ({ value, label })),
          value: current,
          onChange: (v) => { values[f.key] = v; persist(); },
        });
        row.append(s.el);
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
        row.append(sl.el);
      } else {
        const tf = new TextField({
          caption: f.label,
          title: f.hint,
          placeholder: f.default !== undefined ? String(f.default) : undefined,
          value: current,
          onInput: (v) => { values[f.key] = v; persist(); },
        });
        row.append(tf.el);
      }
    }
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
}

/** Modal: the operator wrote this plugin, or they examined the source (AI IDE suggested). */
function mountPackScopeNote(host: HTMLElement, spec: PluginView, wall?: PackWallScope): void {
  const text = packScopeNoteText(spec, wall);
  if (!text) return;
  const note = document.createElement("div");
  note.className = "sec-hint plugin-pack-scope-note";
  note.textContent = text;
  recordPackScopeNoteTextWrite();
  host.append(note);
}

/** Keep pack scope copy in sync with the live mosaic tile list (drawer may stay open). */
export function syncPackScopeNote(root: HTMLElement, spec: PluginView, wall?: PackWallScope): void {
  const text = packScopeNoteText(spec, wall);
  const existing = root.querySelector(".plugin-pack-scope-note");
  if (!text) {
    if (existing) {
      existing.remove();
      recordPackScopeNoteTextWrite();
    }
    return;
  }
  if (existing instanceof HTMLElement) {
    if (existing.textContent !== text) {
      existing.textContent = text;
      recordPackScopeNoteTextWrite();
    }
    return;
  }
  mountPackScopeNote(root, spec, wall);
}

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
