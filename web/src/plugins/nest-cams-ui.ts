import { configStoreId, fieldDefault, specCaption, writePluginConfig, type PluginView } from "./plugin";
import type { PluginField } from "../core/modes";
import { nestNoCamerasFoundForAccount } from "./pack-shared-copy";
import {
  NEST_LAYOUTS,
  nestCamHint,
  nestGridToken,
  nestPickPressed,
  parseNestLook,
  streamableCameras,
  toggleNestPick,
  type NestLook,
  type SdmDevice,
} from "./nest-cams-look";

export type NestCamPatch = Partial<Record<"live" | "stills" | "grid" | "pick", string>>;

function chipRow(
  label: string,
  hint: string,
  opts: { value: string; label: string; hint: string; pressed: boolean; disabled?: boolean }[],
  onPick: (value: string) => void,
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "nest-cam-field";
  const cap = document.createElement("div");
  cap.className = "subcap";
  cap.textContent = label;
  cap.title = hint;
  const row = document.createElement("div");
  row.className = "skypick nest-cam-chips";
  row.setAttribute("role", "group");
  row.setAttribute("aria-label", label);
  for (const o of opts) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sky";
    b.textContent = o.label;
    b.title = o.hint;
    b.disabled = !!o.disabled;
    b.setAttribute("aria-pressed", o.pressed ? "true" : "false");
    b.addEventListener("click", () => onPick(o.value));
    row.appendChild(b);
  }
  wrap.append(cap, row);
  return wrap;
}

function showChips(look: NestLook, onChange: (patch: NestCamPatch) => void): HTMLElement {
  return chipRow(
    "show",
    "Live WebRTC on the wall. Motion stills sit under it, and replace it when live is off.",
    [
      { value: "live", label: "live", hint: "WebRTC video on the wall. Off keeps motion stills only.", pressed: look.live },
      {
        value: "stills",
        label: "stills",
        hint: look.live
          ? "Recent Pub/Sub motion JPEGs under the wall."
          : "Always on while live is off.",
        pressed: look.stills || !look.live,
        disabled: !look.live,
      },
    ],
    (value) => {
      if (value === "live") onChange({ live: look.live ? "0" : "1" });
      if (value === "stills" && look.live) onChange({ stills: look.stills ? "0" : "1" });
    },
  );
}

function layoutChips(look: NestLook, onChange: (patch: NestCamPatch) => void): HTMLElement {
  const token = nestGridToken(look.grid);
  return chipRow(
    "layout",
    "How many live panes. All sizes the wall to the cameras you picked.",
    NEST_LAYOUTS.map((o) => ({ ...o, pressed: o.value === token })),
    (value) => onChange({ grid: value }),
  );
}

function nestCamEmptyStatus(message: string): HTMLElement {
  const empty = document.createElement("div");
  empty.className = "sec-hint nest-cam-empty";
  empty.textContent = message;
  return empty;
}

function cameraChips(look: NestLook, devices: SdmDevice[], onChange: (patch: NestCamPatch) => void): HTMLElement {
  const cams = streamableCameras(devices);
  if (!devices.length) {
    return nestCamEmptyStatus(nestNoCamerasFoundForAccount());
  }
  if (!cams.length) {
    return nestCamEmptyStatus("No Nest cameras can stream yet (Hub displays are skipped).");
  }
  const allOn = !look.pick;
  return chipRow(
    "cameras",
    "Empty / all on means every camera that can stream. Turning one off keeps the rest — extras are not filled in.",
    [
      { value: "", label: "all", hint: "every streamable camera, up to the layout cap", pressed: allOn },
      ...cams.map((cam) => ({
        value: cam.label,
        label: cam.label,
        hint: nestCamHint(cam, cams),
        pressed: nestPickPressed(look.pick, cam),
      })),
    ],
    (value) => {
      if (value === "") {
        onChange({ pick: "" });
        return;
      }
      const cam = cams.find((c) => c.label === value);
      if (!cam) return;
      onChange({ pick: toggleNestPick(look.pick, cam, cams) });
    },
  );
}

export function paintNestCamControls(
  host: HTMLElement,
  look: NestLook,
  devices: SdmDevice[],
  onChange: (patch: NestCamPatch) => void,
): void {
  host.replaceChildren();
  host.classList.add("nest-cam-controls");
  host.append(showChips(look, onChange), layoutChips(look, onChange), cameraChips(look, devices, onChange));
}

export function mountNestCamFields(
  host: HTMLElement,
  spec: PluginView,
  fields: PluginField[],
  values: Record<string, string>,
  devices: SdmDevice[],
  onPersist: (id: string, values: Record<string, string>) => void,
): PluginField[] {
  const rest: PluginField[] = [];
  for (const f of fields) {
    if (f.key === "live" || f.key === "stills" || f.key === "grid" || f.key === "pick") continue;
    rest.push(f);
  }
  const persistPatch = (patch: NestCamPatch) => {
    Object.assign(values, patch);
    for (const f of fields) {
      if (values[f.key] === undefined) values[f.key] = fieldDefault(f);
    }
    writePluginConfig(configStoreId(spec), values);
    onPersist(configStoreId(spec), values);
    paintNestCamControls(controls, parseNestLook(values), devices, persistPatch);
  };
  const box = document.createElement("div");
  box.className = "sec nest-cam-settings";
  const title = document.createElement("div");
  title.className = "sec-title";
  title.textContent = specCaption(spec);
  const hint = document.createElement("div");
  hint.className = "sec-hint";
  hint.textContent = "Show is live video vs motion stills. Layout caps how many live panes. Cameras are the wall — named picks stay named, they are not padded with extras. Stills follow the same camera pick.";
  const controls = document.createElement("div");
  paintNestCamControls(controls, parseNestLook(values), devices, persistPatch);
  box.append(title, hint, controls);
  host.append(box);
  return rest;
}
