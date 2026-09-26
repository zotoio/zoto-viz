/** Host-injected iframe shim (not bundled in plugins/sdk). Auto-publishes duplicate-tile surfaces. */

export const SANDBOX_DUPLICATE_TILE_SHIM = `
(function () {
  const zoto = globalThis.zoto;
  if (!zoto) return;
  let dupTiles = 0;
  let publishInFlight = false;
  const surface = document.createElement("canvas");
  surface.setAttribute("data-zoto-surface", "1");
  surface.width = 2;
  surface.height = 2;
  document.body.appendChild(surface);
  function fail() {
    parent.postMessage({ source: "zoto-viz-plugin", type: "publishBitmapFailed", payload: {} }, "*");
  }
  function emit(bitmap) {
    parent.postMessage({ source: "zoto-viz-plugin", type: "publishBitmap", payload: { bitmap } }, "*", [bitmap]);
  }
  function publish() {
    if (!allowed.has("viz.write") || dupTiles < 2 || publishInFlight) return;
    publishInFlight = true;
    const done = () => { publishInFlight = false; };
    if (typeof surface.transferToImageBitmap === "function") {
      try {
        emit(surface.transferToImageBitmap());
        done();
      } catch (e) {
        done();
        fail();
      }
      return;
    }
    if (typeof createImageBitmap !== "function") {
      done();
      fail();
      return;
    }
    createImageBitmap(surface).then((b) => { emit(b); done(); }, () => { done(); fail(); });
  }
  let userOnFrame = null;
  Object.defineProperty(zoto, "onFrame", {
    configurable: true,
    enumerable: true,
    get() { return userOnFrame; },
    set(fn) {
      userOnFrame = typeof fn === "function"
        ? (frame) => { fn(frame); publish(); }
        : fn;
    },
  });
  window.addEventListener("message", (ev) => {
    const d = ev.data;
    if (!d || d.source !== "zoto-viz-host") return;
    if (d.type === "dupTiles") dupTiles = Number(d.count) || 0;
  });
})();
`;

/** Optional manual publish helper (unit tests only — not shipped in PLUGIN_SDK). */
export const SANDBOX_PUBLISH_SURFACE_SDK = `
zoto.publishSurface = function(canvas) {
  if (!vizAllowed("viz.write") || !canvas) return;
  function emit(bitmap) {
    send("publishBitmap", { bitmap }, [bitmap]);
  }
  function fail() {
    send("publishBitmapFailed", {});
  }
  if (typeof canvas.transferToImageBitmap === "function") {
    try { emit(canvas.transferToImageBitmap()); } catch (e) { fail(); }
    return;
  }
  if (typeof createImageBitmap !== "function") { fail(); return; }
  createImageBitmap(canvas).then(emit, fail);
};
`;
