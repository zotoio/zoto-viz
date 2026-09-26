/** Inline VizPlugin SDK fragment appended to PLUGIN_SDK in the sandbox iframe. */

/** Sandbox duplicate-tile surface publish (also used in unit tests). */
export const SANDBOX_PUBLISH_SURFACE_SDK = `
zoto.publishSurface = function(canvas) {
  if (!vizAllowed("viz.write") || !canvas) return;
  const pluginId = (window.__zotoConfig && window.__zotoConfig.pluginId) || "";
  function emit(bitmap) {
    send("publishBitmap", { bitmap, pluginId }, [bitmap]);
  }
  function fail() {
    send("publishBitmapFailed", { pluginId });
  }
  if (typeof canvas.transferToImageBitmap === "function") {
    try {
      emit(canvas.transferToImageBitmap());
    } catch (e) {
      fail();
    }
    return;
  }
  if (typeof createImageBitmap !== "function") {
    fail();
    return;
  }
  createImageBitmap(canvas).then(emit, fail);
};
`;

export const VIZ_PLUGIN_SDK = `
function vizAllowed(cap) { return allowed.has(cap); }
zoto.onFrame = null;
zoto.writeBuffer = function(slot, data) {
  if (!vizAllowed("viz.write")) return;
  const arr = Array.isArray(data) ? data : Array.from(data);
  send("writeBuffer", { slot, data: arr });
};
zoto.writeUniform = function(name, value) {
  if (!vizAllowed("viz.write")) return;
  send("writeUniform", { name, value });
};
zoto.writeParticles = function(data, stride) {
  if (!vizAllowed("viz.write")) return;
  const arr = Array.isArray(data) ? data : Array.from(data);
  send("writeParticles", { data: arr, stride: stride || 4 });
};
${SANDBOX_PUBLISH_SURFACE_SDK}
window.addEventListener("message", (ev) => {
  const d = ev.data;
  if (!d || d.source !== "zoto-viz-host") return;
  if (d.type === "frame" && vizAllowed("viz.read") && window.zoto.onFrame) window.zoto.onFrame(d.frame);
});
`;
