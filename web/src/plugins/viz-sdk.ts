/** Inline VizPlugin SDK fragment appended to PLUGIN_SDK in the sandbox iframe. */

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
window.addEventListener("message", (ev) => {
  const d = ev.data;
  if (!d || d.source !== "zoto-viz-host") return;
  if (d.type === "frame" && vizAllowed("viz.read")) {
    if (window.zoto.onFrame) window.zoto.onFrame(d.frame);
  }
});
`;
