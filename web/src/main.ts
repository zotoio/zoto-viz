import { NetScene } from "./scene";
import { Panel } from "./panel";
import { MODES, defaultOpts, modeById, type ViewMode } from "./modes";
import { fmtBytes, type StateMsg } from "./types";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const scene = new NetScene($("scene"));
const panel = new Panel($("panel"), scene);
scene.onSelect = (d) => panel.show(d);
(window as unknown as { netviz: NetScene }).netviz = scene; // devtools handle

// ---------------------------------------------------------------- view modes

const modeSel = $<HTMLSelectElement>("mode");
for (const m of MODES) {
  const o = document.createElement("option");
  o.value = m.id;
  o.textContent = `${MODES.indexOf(m) + 1} · ${m.label}`;
  modeSel.appendChild(o);
}

function optsFor(m: ViewMode): Record<string, string> {
  const o = defaultOpts(m);
  for (const k of Object.keys(o)) {
    const saved = localStorage.getItem(`netviz.mode.${m.id}.${k}`);
    if (saved !== null && m.options!.find((x) => x.key === k)!.values.some(([v]) => v === saved)) o[k] = saved;
  }
  return o;
}

function applyMode(id: string): void {
  const m = modeById(id);
  const opts = optsFor(m);
  modeSel.value = m.id;
  localStorage.setItem("netviz.mode", m.id);
  scene.setMode(m, opts);

  // per-mode option selects
  const box = $("modeOpts");
  box.innerHTML = "";
  for (const opt of m.options ?? []) {
    const label = document.createElement("label");
    label.className = "opt";
    label.append(`${opt.label} `);
    const sel = document.createElement("select");
    for (const [v, text] of opt.values) {
      const o = document.createElement("option");
      o.value = v; o.textContent = text;
      sel.appendChild(o);
    }
    sel.value = opts[opt.key];
    sel.addEventListener("change", () => {
      opts[opt.key] = sel.value;
      localStorage.setItem(`netviz.mode.${m.id}.${opt.key}`, sel.value);
      scene.setMode(m, opts);
      renderLegend(m, opts);
    });
    label.appendChild(sel);
    box.appendChild(label);
  }
  renderLegend(m, opts);
  $("hint").textContent = m.hint;
}

function renderLegend(m: ViewMode, opts: Record<string, string>): void {
  const el = $("legend");
  el.innerHTML = "";
  for (const item of m.legend(opts)) {
    const s = document.createElement("span");
    const i = document.createElement("i");
    i.style.background = item.color;
    if (item.line) i.classList.add("line");
    if (item.color === "transparent") i.classList.add("none");
    s.append(i, item.label);
    el.appendChild(s);
  }
}

modeSel.addEventListener("change", () => applyMode(modeSel.value));
applyMode(localStorage.getItem("netviz.mode") ?? MODES[0].id);

for (const [id, key] of [["showInternet", "internet"], ["showMulticast", "multicast"], ["showOffline", "offline"], ["showLabels", "labels"]] as const) {
  const cb = $<HTMLInputElement>(id);
  const saved = localStorage.getItem(`netviz.${key}`);
  if (saved !== null) cb.checked = saved === "1";
  scene.setFilters({ [key]: cb.checked });
  cb.addEventListener("change", () => { scene.setFilters({ [key]: cb.checked }); localStorage.setItem(`netviz.${key}`, cb.checked ? "1" : "0"); });
}

function applyStats(m: StateMsg): void {
  const extra = (m.interfaces ?? []).filter((i) => i !== m.iface);
  $("net").textContent = `${m.iface}${extra.length ? ` +${extra.join(", ")}` : ""} · ${m.network} · gw ${m.gateway}`;
  $("pps").textContent = Math.round(m.stats.pps).toLocaleString();
  $("bps").textContent = fmtBytes(m.stats.bps, true);
  $("devs").textContent = String(m.stats.devices);
  $("online").textContent = String(m.stats.online);
  $("flows").textContent = String(m.stats.flows);
  $("active").textContent = String(m.stats.active_flows);
}

function connect(): void {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/ws`);
  const dot = $("conn");
  ws.onopen = () => dot.classList.add("ok");
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data) as StateMsg;
    if (m.type !== "state") return;
    applyStats(m);
    scene.update(m);
  };
  ws.onclose = () => { dot.classList.remove("ok"); setTimeout(connect, 2000); };
  ws.onerror = () => ws.close();
}
connect();

window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLSelectElement || e.target instanceof HTMLInputElement) return;
  if (e.key === "Escape") scene.select(null);
  const idx = Number(e.key) - 1;
  if (idx >= 0 && idx < MODES.length && !e.ctrlKey && !e.metaKey && !e.altKey) applyMode(MODES[idx].id);
});
