import { VIZ_PLUGIN_SDK } from "./viz-sdk";

/** Copied into the sandboxed iframe. No DOM, fetch, or camera. */

export const PLUGIN_SDK = `
const allowed = new Set(JSON.parse(document.currentScript.dataset.caps || "[]"));
const parent = window.parent;
function send(type, payload) {
  parent.postMessage({ source: "zoto-viz-plugin", type, payload }, "*");
}
window.zoto = {
  onTick: null,
  onConfig: null,
  onFrame: null,
  /** @type {((tick: { frameMs: number, tileId: string, pluginClock?: number }) => void)|null} */
  onPresent: null,
  setStyle(s) { if (allowed.has("graph.style")) send("setStyle", s); },
  setNodeColor(id, hex) { if (allowed.has("graph.style")) send("setNodeColor", { id, hex }); },
  writeBuffer() {},
  writeUniform() {},
  writeParticles() {},
  getConfig() { return window.__zotoConfig || {}; },
};
window.addEventListener("message", (ev) => {
  const d = ev.data;
  if (!d || d.source !== "zoto-viz-host") return;
  if (d.type === "init") {
    window.__zotoConfig = d.config || {};
    window.__zotoViz = d.viz || null;
    window.__zotoContractVersion = d.contractVersion || 0;
  }
  if (d.type === "config") { window.__zotoConfig = d.config || {}; window.zoto.onConfig && window.zoto.onConfig(d.config); }
  if (d.type === "tick" && allowed.has("graph.read") && window.zoto.onTick) window.zoto.onTick(d.nodes);
});
${VIZ_PLUGIN_SDK}
send("ready");
`;
