import { NetScene } from "./scene";
import { Panel } from "./panel";
import { fmtBytes, type StateMsg } from "./types";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const scene = new NetScene($("scene"));
const panel = new Panel($("panel"), scene);
scene.onSelect = (d) => panel.show(d);

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
  if (e.key === "Escape") scene.select(null);
});
