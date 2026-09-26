const SETTINGS_KEY = "zoto-viz.vizGovernor";

export function loadVizGovernorSetting(): boolean {
  try {
    return localStorage.getItem(SETTINGS_KEY) === "1";
  } catch {
    return false;
  }
}

export function setVizGovernorSetting(on: boolean): void {
  localStorage.setItem(SETTINGS_KEY, on ? "1" : "0");
}

/**
 * Host render-scale governor enablement. Off by default until tuned on real GPU hardware.
 * Settings persist; `?vizGovernor=1` or `?vizGovernor=0` overrides for one load.
 */
export function resolveVizGovernorEnabled(
  search = typeof location !== "undefined" ? location.search : "",
  settingsOn = loadVizGovernorSetting(),
): boolean {
  const q = new URLSearchParams(search);
  const param = q.get("vizGovernor");
  if (param === "1" || param === "true") return true;
  if (param === "0" || param === "false") return false;
  return settingsOn;
}

let hostGovernorEnabled = false;

/** Updated when settings or URL resolve; read from render tick paths. */
export function hostRenderScaleGovernorEnabled(): boolean {
  return hostGovernorEnabled;
}

export function refreshHostRenderScaleGovernorEnabled(
  search = typeof location !== "undefined" ? location.search : "",
): boolean {
  hostGovernorEnabled = resolveVizGovernorEnabled(search);
  return hostGovernorEnabled;
}
