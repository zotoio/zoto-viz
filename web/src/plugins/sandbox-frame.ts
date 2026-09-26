/**
 * Same-origin plugin runtime frame (loaded in a sandboxed iframe).
 * External module only — no inline script, so the app CSP never needs 'unsafe-inline'.
 */

type HostBoot = {
  source: "zoto-viz-host";
  type: "boot";
  caps: string[];
  config: Record<string, string>;
  viz?: unknown;
  moduleSrc: string;
};

type HostMsg =
  | { source: "zoto-viz-host"; type: "init"; caps: string[]; config: Record<string, string>; viz?: unknown }
  | { source: "zoto-viz-host"; type: "tick"; nodes: { id: string; rate: number; role: string }[] }
  | { source: "zoto-viz-host"; type: "frame"; frame: unknown }
  | { source: "zoto-viz-host"; type: "config"; config: Record<string, string> };

let allowed = new Set<string>();

function send(type: string, payload?: unknown): void {
  parent.postMessage({ source: "zoto-viz-plugin", type, payload }, "*");
}

const zoto = {
  onTick: null as ((nodes: { id: string; rate: number; role: string }[]) => void) | null,
  onConfig: null as ((config: Record<string, string>) => void) | null,
  onFrame: null as ((frame: unknown) => void) | null,
  setStyle(s: Record<string, unknown>) { if (allowed.has("graph.style")) send("setStyle", s); },
  setNodeColor(id: string, hex: number) { if (allowed.has("graph.style")) send("setNodeColor", { id, hex }); },
  writeBuffer(_slot: number, _data: number[] | ArrayLike<number>) { /* viz.write patched after boot */ },
  writeUniform(_name: string, _value: unknown) { /* viz.write patched after boot */ },
  writeParticles(_data: number[] | ArrayLike<number>, _stride?: number) { /* viz.write patched after boot */ },
  getConfig() { return (window as unknown as { __zotoConfig?: Record<string, string> }).__zotoConfig || {}; },
};

(globalThis as unknown as { zoto: typeof zoto }).zoto = zoto;

function vizAllowed(cap: string): boolean {
  return allowed.has(cap);
}

function patchVizWriters(): void {
  zoto.writeBuffer = (slot, data) => {
    if (!vizAllowed("viz.write")) return;
    const arr = Array.isArray(data) ? data : Array.from(data);
    send("writeBuffer", { slot, data: arr });
  };
  zoto.writeUniform = (name, value) => {
    if (!vizAllowed("viz.write")) return;
    send("writeUniform", { name, value });
  };
  zoto.writeParticles = (data, stride) => {
    if (!vizAllowed("viz.write")) return;
    const arr = Array.isArray(data) ? data : Array.from(data);
    send("writeParticles", { data: arr, stride: stride || 4 });
  };
}

function applyInit(d: { caps?: string[]; config?: Record<string, string>; viz?: unknown }): void {
  allowed = new Set(d.caps ?? []);
  (window as unknown as { __zotoConfig?: Record<string, string> }).__zotoConfig = d.config || {};
  (window as unknown as { __zotoViz?: unknown }).__zotoViz = d.viz || null;
  patchVizWriters();
}

window.addEventListener("message", (ev) => {
  const d = ev.data as HostMsg | HostBoot | undefined;
  if (!d || d.source !== "zoto-viz-host") return;
  if (d.type === "config") {
    (window as unknown as { __zotoConfig?: Record<string, string> }).__zotoConfig = d.config || {};
    zoto.onConfig?.(d.config || {});
    return;
  }
  if (d.type === "tick" && allowed.has("graph.read") && zoto.onTick) zoto.onTick(d.nodes);
  if (d.type === "frame" && vizAllowed("viz.read") && zoto.onFrame) zoto.onFrame(d.frame);
});

window.addEventListener("message", async (ev) => {
  const d = ev.data as HostBoot | undefined;
  if (!d || d.source !== "zoto-viz-host" || d.type !== "boot") return;
  applyInit(d);
  try {
    await import(/* @vite-ignore */ d.moduleSrc);
    send("ready");
  } catch (e) {
    send("log", String(e));
  }
});

send("frame-ready");
