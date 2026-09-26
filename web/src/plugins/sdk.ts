import { VIZ_PLUGIN_SDK } from "./viz-sdk";

/** Copied into the sandboxed iframe. No DOM, fetch, or camera. */

export const PLUGIN_SDK = `
const allowed = new Set(JSON.parse(document.currentScript.dataset.caps || "[]"));
const parent = window.parent;
function send(type, payload, transfer) {
  parent.postMessage({ source: "zoto-viz-plugin", type, payload }, "*", transfer || []);
}
window.zoto = {
  onTick: null,
  onConfig: null,
  onFrame: null,
  setStyle(s) { if (allowed.has("graph.style")) send("setStyle", s); },
  setNodeColor(id, hex) { if (allowed.has("graph.style")) send("setNodeColor", { id, hex }); },
  writeBuffer() {},
  writeUniform() {},
  writeParticles() {},
  getConfig() { return window.__zotoConfig || {}; },
  publishSurface(canvas) {
    if (!vizAllowed("viz.write") || !canvas || typeof canvas.transferToImageBitmap !== "function") return;
    const bitmap = canvas.transferToImageBitmap();
    const pluginId = (window.__zotoConfig && window.__zotoConfig.pluginId) || "";
    send("publishBitmap", { bitmap, pluginId }, [bitmap]);
  },
};
window.addEventListener("message", (ev) => {
  const d = ev.data;
  if (!d || d.source !== "zoto-viz-host") return;
  if (d.type === "init") { window.__zotoConfig = d.config || {}; window.__zotoViz = d.viz || null; }
  if (d.type === "config") { window.__zotoConfig = d.config || {}; window.zoto.onConfig && window.zoto.onConfig(d.config); }
  if (d.type === "tick" && allowed.has("graph.read") && window.zoto.onTick) window.zoto.onTick(d.nodes);
});
${VIZ_PLUGIN_SDK}
send("ready");
`;
