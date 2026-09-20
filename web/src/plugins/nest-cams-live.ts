import { apiFetch } from "../core/http";
import { AUTH_SETUPS, renderAuthSetup } from "../core/auth-setup";

export type SdmDevice = {
  id: string;
  label: string;
  room?: string;
  type?: string;
  camera?: boolean;
  webrtc?: boolean;
};

export type SdmEvent = {
  ts?: string;
  device?: string;
  kinds?: string[];
  event_id?: string;
};

export type SdmStatus = {
  linked?: boolean;
  pcm_url?: string | null;
  error?: string;
  devices?: SdmDevice[];
  events?: SdmEvent[];
  client_id?: string;
  enterprise_id?: string;
};

export type NestLook = { live: boolean; pick: string; grid: number };

type NestPane = {
  cam: SdmDevice;
  figure: HTMLElement;
  video: HTMLVideoElement;
  cap: HTMLElement;
  pc: RTCPeerConnection | null;
  sessionId: string;
  extendTimer: number;
};

export function nestStillSrc(device: string, event: string): string {
  return `/api/sdm/still?device=${encodeURIComponent(device)}&event=${encodeURIComponent(event)}`;
}

export function streamableCameras(devices: SdmDevice[] | undefined): SdmDevice[] {
  return (devices ?? []).filter((d) => d.camera !== false && d.type !== "display" && d.webrtc !== false);
}

export function nestCamCaption(cam: SdmDevice): string {
  return cam.room && cam.room !== cam.label ? `${cam.label} · ${cam.room}` : cam.label;
}

export function parsePicks(pick: string): string[] {
  return pick.split(",").map((s) => s.trim()).filter(Boolean);
}

export function clampNestGrid(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 4;
  return Math.min(6, Math.max(1, Math.round(n)));
}

export function parseNestLook(cfg: Record<string, string> | undefined): NestLook {
  const live = cfg?.live !== "0" && cfg?.live !== "false";
  return { live, pick: (cfg?.pick ?? "").trim(), grid: clampNestGrid(cfg?.grid) };
}

/** Event stills sit under a 1-pane live view, or replace the wall when live is off. */
export function nestShowEventTiles(live: boolean, grid: number): boolean {
  return !live || grid < 2;
}

export function nestIdleNote(live: boolean, events: SdmEvent[]): string {
  if (live) return "";
  if (events.some((e) => e.device && e.event_id)) return "";
  return "Live stream off. No recent motion stills.";
}

export function sdmSyncKey(sdm: SdmStatus | undefined, look: NestLook): string {
  return JSON.stringify({
    linked: sdm?.linked,
    pcm_url: sdm?.pcm_url,
    error: sdm?.error,
    devices: sdm?.devices,
    events: sdm?.events,
    live: look.live,
    pick: look.pick,
    grid: look.grid,
  });
}

export function firstCamera(devices: SdmDevice[] | undefined, pick: string): SdmDevice | null {
  return gridCameras(devices, pick, 1)[0] ?? null;
}

/** Fill up to `grid` panes: named picks first (comma-separated), then remaining streamable cameras. */
export function gridCameras(devices: SdmDevice[] | undefined, pick: string, grid: number): SdmDevice[] {
  const n = Math.min(6, Math.max(0, Math.round(grid)));
  if (n <= 0) return [];
  const rows = devices ?? [];
  const used = new Set<string>();
  const out: SdmDevice[] = [];
  for (const want of parsePicks(pick)) {
    const hit = rows.find((d) => d.id === want || d.label === want);
    if (!hit || used.has(hit.id)) continue;
    used.add(hit.id);
    out.push(hit);
    if (out.length >= n) return out;
  }
  for (const cam of streamableCameras(rows)) {
    if (used.has(cam.id)) continue;
    used.add(cam.id);
    out.push(cam);
    if (out.length >= n) break;
  }
  return out;
}

export function nestStreamFailover(err: string): boolean {
  return /not available for streaming|internal error|unavailable|rate.?limit|try again/i.test(err);
}

function sdpLines(sdp: string): { lines: string[]; nl: string } {
  const nl = sdp.includes("\r\n") ? "\r\n" : "\n";
  return { lines: sdp.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n"), nl };
}

function sdpDirection(sdp: string, kind: string): string {
  let inSec = false;
  for (const line of sdpLines(sdp).lines) {
    if (line.startsWith("m=")) inSec = line.startsWith(`m=${kind}`);
    else if (inSec && line.startsWith("a=")) {
      for (const d of ["sendrecv", "sendonly", "recvonly", "inactive"]) {
        if (line === `a=${d}` || line.startsWith(`a=${d}:`)) return d;
      }
    }
  }
  return "";
}

/** Nest answers a=sendrecv to recvonly offers; Chromium 143+ then paints no frames. */
export function fixNestAnswerSdp(offerSdp: string, answerSdp: string): string {
  if (!offerSdp.trim() || !answerSdp.trim()) return answerSdp;
  const { lines, nl } = sdpLines(answerSdp);
  const out: string[] = [];
  let kind = "";
  let cand = 1;
  for (const line of lines) {
    if (line.startsWith("m=")) kind = line.slice(2).split(" ", 1)[0] ?? "";
    if ((kind === "audio" || kind === "video") && line === "a=sendrecv" && sdpDirection(offerSdp, kind) === "recvonly") {
      out.push("a=sendonly");
      continue;
    }
    if (line.startsWith("a=candidate: ")) {
      out.push(line.replace("a=candidate: ", `a=candidate:${cand} `));
      cand += 1;
      continue;
    }
    out.push(line);
  }
  let text = out.join(nl);
  if (answerSdp.endsWith("\n") && !text.endsWith(nl)) text += nl;
  return text;
}

function preferNestVideoCodecs(pc: RTCPeerConnection): void {
  const caps = RTCRtpReceiver.getCapabilities("video");
  if (!caps?.codecs.length) return;
  const liked = caps.codecs.filter((c) => {
    const fmtp = c.sdpFmtpLine ?? "";
    return /h264/i.test(c.mimeType) && /profile-level-id=42[0e]01f/i.test(fmtp);
  });
  const rtx = caps.codecs.filter((c) => /rtx/i.test(c.mimeType));
  if (!liked.length) return;
  for (const t of pc.getTransceivers()) {
    if (t.receiver.track.kind !== "video") continue;
    try { t.setCodecPreferences([...liked, ...rtx]); } catch { /* older engines */ }
  }
}

async function gatherOffer(pc: RTCPeerConnection): Promise<string> {
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  if (pc.iceGatheringState !== "complete") {
    await new Promise<void>((resolve) => {
      const t = window.setTimeout(() => resolve(), 4000);
      const on = (): void => {
        if (pc.iceGatheringState === "complete") {
          window.clearTimeout(t);
          pc.removeEventListener("icegatheringstatechange", on);
          resolve();
        }
      };
      pc.addEventListener("icegatheringstatechange", on);
    });
  }
  let sdp = pc.localDescription?.sdp || offer.sdp || "";
  if (sdp && !sdp.endsWith("\n")) sdp += "\n";
  return sdp;
}

/** Stage-only labeled camera wall + WebRTC panes. Same-origin SDP exchange; ICE is browser-to-Nest. */
export class NestCamsLive {
  readonly el: HTMLElement;
  private readonly wall: HTMLElement;
  private readonly status: HTMLElement;
  private readonly tiles: HTMLElement;
  private panes: NestPane[] = [];
  private active = false;
  private liveOn = true;
  private pick = "";
  private grid = 4;
  private devices: SdmDevice[] = [];
  private lastJson = "";
  private connecting = false;
  private wallKey = "";

  constructor(host: HTMLElement) {
    this.el = document.createElement("section");
    this.el.id = "nest-cams";
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="nest-cams-wall" data-count="0"></div>
      <div class="nest-cams-status" hidden></div>
      <div class="nest-cams-tiles"></div>`;
    this.wall = this.el.querySelector(".nest-cams-wall")!;
    this.status = this.el.querySelector(".nest-cams-status")!;
    this.tiles = this.el.querySelector(".nest-cams-tiles")!;
    host.append(this.el);
  }

  setActive(on: boolean): void {
    this.active = on;
    if (!on) this.stopAll();
    this.el.hidden = !on;
  }

  setLook(cfg: Record<string, string> | undefined): void {
    const look = parseNestLook(cfg);
    const changed = look.live !== this.liveOn || look.pick !== this.pick || look.grid !== this.grid;
    this.liveOn = look.live;
    this.pick = look.pick;
    this.grid = look.grid;
    if (!changed) return;
    this.lastJson = "";
    if (!this.liveOn) this.stopAll();
  }

  sync(sdm: SdmStatus | undefined): void {
    if (!this.active) {
      this.el.hidden = true;
      return;
    }
    this.el.hidden = false;
    const look = { live: this.liveOn, pick: this.pick, grid: this.grid };
    const json = sdmSyncKey(sdm, look);
    if (json === this.lastJson) return;
    this.lastJson = json;
    this.devices = sdm?.devices ?? [];
    const events = sdm?.events ?? [];
    if (!sdm?.linked) {
      this.status.replaceChildren(renderAuthSetup(AUTH_SETUPS.sdm, { pcmUrl: sdm?.pcm_url }));
      if (sdm?.error) {
        const err = document.createElement("p");
        err.textContent = sdm.error;
        this.status.appendChild(err);
      }
      this.status.hidden = false;
      this.tiles.replaceChildren();
      this.stopAll();
      this.buildWall([]);
      return;
    }
    const wanted = this.liveOn ? gridCameras(this.devices, this.pick, this.grid) : [];
    if (sdm.error) this.setNote(sdm.error);
    else this.setNote(nestIdleNote(this.liveOn, events));
    if (nestShowEventTiles(this.liveOn, this.grid)) this.paintTiles(this.devices, events);
    else this.tiles.replaceChildren();
    if (wanted.length) void this.ensureWall(wanted);
    else this.stopAll();
  }

  dispose(): void {
    this.stopAll();
    this.el.remove();
  }

  private setNote(text: string): void {
    this.status.replaceChildren();
    this.status.textContent = text;
    this.status.hidden = !text;
  }

  private paintTiles(devices: SdmDevice[], events: SdmEvent[]): void {
    this.tiles.replaceChildren();
    for (const ev of events.slice(0, 8)) {
      if (!ev.device || !ev.event_id) continue;
      const fig = document.createElement("figure");
      const img = document.createElement("img");
      img.alt = (ev.kinds ?? []).join(" ") || "event";
      img.src = nestStillSrc(ev.device, ev.event_id);
      const cap = document.createElement("figcaption");
      const dev = devices.find((d) => d.id === ev.device);
      cap.textContent = `${dev?.label ?? ev.device} · ${(ev.kinds ?? []).join(" ")}`;
      fig.append(img, cap);
      this.tiles.append(fig);
    }
  }

  private buildWall(wanted: SdmDevice[]): void {
    this.wall.replaceChildren();
    this.wall.dataset.count = String(wanted.length);
    this.panes = wanted.map((cam) => {
      const figure = document.createElement("figure");
      const video = document.createElement("video");
      video.playsInline = true;
      video.autoplay = true;
      video.muted = true;
      const cap = document.createElement("figcaption");
      cap.textContent = nestCamCaption(cam);
      figure.append(video, cap);
      this.wall.append(figure);
      return { cam, figure, video, cap, pc: null, sessionId: "", extendTimer: 0 };
    });
    this.wallKey = wanted.map((c) => c.id).join("|");
  }

  private async ensureWall(wanted: SdmDevice[]): Promise<void> {
    if (this.connecting) return;
    const key = wanted.map((c) => c.id).join("|");
    if (key === this.wallKey && this.panes.length && this.panes.every((p) => p.pc)) return;
    this.connecting = true;
    try {
      if (key !== this.wallKey) {
        this.stopAll();
        this.buildWall(wanted);
      }
      const tried = new Set<string>();
      for (const pane of this.panes) {
        if (!this.active || !this.liveOn) return;
        if (pane.pc) {
          tried.add(pane.cam.id);
          continue;
        }
        const extras = this.pick
          ? []
          : streamableCameras(this.devices).filter((c) => c.id !== pane.cam.id && !tried.has(c.id));
        for (const cam of [pane.cam, ...extras]) {
          if (tried.has(cam.id)) continue;
          tried.add(cam.id);
          if (cam.id !== pane.cam.id) {
            this.stopPane(pane);
            pane.cam = cam;
          }
          const err = await this.connectPane(pane);
          if (!err || err === "aborted") break;
          if (this.pick || !nestStreamFailover(err)) break;
          await new Promise((r) => window.setTimeout(r, /rate.?limit/i.test(err) ? 4000 : 800));
        }
        await new Promise((r) => window.setTimeout(r, 2000));
      }
    } finally {
      this.connecting = false;
    }
  }

  private async connectPane(pane: NestPane): Promise<string | null> {
    if (pane.pc) return null;
    const deviceId = pane.cam.id;
    pane.cap.textContent = nestCamCaption(pane.cam);
    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    pane.pc = pc;
    pc.addTransceiver("audio", { direction: "recvonly" });
    pc.addTransceiver("video", { direction: "recvonly" });
    preferNestVideoCodecs(pc);
    pc.createDataChannel("data");
    const stream = new MediaStream();
    pane.video.srcObject = stream;
    pc.ontrack = (ev) => {
      stream.addTrack(ev.track);
      void pane.video.play().catch(() => {});
    };
    const iceNote = (): void => {
      pane.figure.dataset.ice = pc.iceConnectionState;
      pane.figure.dataset.conn = pc.connectionState;
    };
    pc.oniceconnectionstatechange = iceNote;
    pc.onconnectionstatechange = iceNote;
    try {
      const offerSdp = await gatherOffer(pc);
      if (pane.pc !== pc) return "aborted";
      const r = await apiFetch(`/api/sdm/devices/${encodeURIComponent(deviceId)}/webrtc`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ offerSdp }),
      });
      const body = await r.json() as { error?: string; answerSdp?: string; mediaSessionId?: string };
      if (pane.pc !== pc) return "aborted";
      if (!r.ok || !body.answerSdp) {
        if (pane.pc === pc) this.stopPane(pane);
        const err = body.error || `stream ${r.status}`;
        pane.cap.textContent = `${nestCamCaption(pane.cam)} · ${err}`;
        return err;
      }
      const sid = body.mediaSessionId || "";
      if (pane.pc !== pc || pc.signalingState === "closed") {
        this.releaseSession(deviceId, sid);
        return "aborted";
      }
      pane.sessionId = sid;
      await pc.setRemoteDescription({ type: "answer", sdp: fixNestAnswerSdp(offerSdp, body.answerSdp) });
      if (pane.pc !== pc) {
        this.releaseSession(deviceId, sid);
        return "aborted";
      }
      if (pane.sessionId) {
        pane.extendTimer = window.setInterval(() => { void this.extend(pane); }, 240_000);
      }
      return null;
    } catch (e) {
      if (pane.pc !== pc || pc.signalingState === "closed") return "aborted";
      this.stopPane(pane);
      const err = e instanceof Error ? e.message : "stream failed";
      pane.cap.textContent = `${nestCamCaption(pane.cam)} · ${err}`;
      return err;
    }
  }

  private releaseSession(deviceId: string, sessionId: string): void {
    if (!sessionId) return;
    void apiFetch(`/api/sdm/devices/${encodeURIComponent(deviceId)}/webrtc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ stop: true, mediaSessionId: sessionId }),
    }).catch(() => {});
  }

  private async extend(pane: NestPane): Promise<void> {
    if (!pane.sessionId) return;
    await apiFetch(`/api/sdm/devices/${encodeURIComponent(pane.cam.id)}/webrtc`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ extend: true, mediaSessionId: pane.sessionId }),
    }).catch(() => {});
  }

  private stopPane(pane: NestPane): void {
    if (pane.extendTimer) window.clearInterval(pane.extendTimer);
    pane.extendTimer = 0;
    if (pane.sessionId) this.releaseSession(pane.cam.id, pane.sessionId);
    pane.sessionId = "";
    pane.pc?.close();
    pane.pc = null;
    pane.video.srcObject = null;
  }

  private stopAll(): void {
    for (const pane of this.panes) this.stopPane(pane);
    this.wallKey = "";
  }
}
