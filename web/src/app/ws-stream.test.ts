import { describe, expect, it } from "vitest";
import { applyPatch } from "./state-delta";
import { backoffDelay, DEFAULT_STREAM_CONFIG, StateStream, type VisDoc } from "./ws-stream";

class FakeSock {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];
  closed = false;
  send(d: string) { this.sent.push(d); }
  close() { this.closed = true; }
  open() { this.readyState = 1; this.onopen?.(); }
  msg(o: unknown) { this.onmessage?.({ data: JSON.stringify(o) }); }
  drop() { this.onclose?.(); }
}

function rig(cfg = {}) {
  const socks: FakeSock[] = [];
  const timers: { fn: () => void; at: number; id: number }[] = [];
  let now = 0;
  let id = 0;
  const l = new Set<() => void>();
  const doc: VisDoc & { l: Set<() => void> } = { visibilityState: "visible", l,
    addEventListener(_: string, f: () => void) { l.add(f); }, removeEventListener(_: string, f: () => void) { l.delete(f); } };
  const states: Record<string, unknown>[] = [];
  const s = new StateStream({
    url: "ws://x/ws?proto=delta",
    makeSocket: () => { const k = new FakeSock(); socks.push(k); return k; },
    setTimeout: (fn, ms) => { timers.push({ fn, at: now + ms, id: ++id }); return id; },
    clearTimeout: (t) => { const i = timers.findIndex((x) => x.id === t); if (i >= 0) timers.splice(i, 1); },
    now: () => now,
    random: () => 0.5,
    doc,
  }, { onState: (m) => states.push(m) }, cfg);
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const t = timers[0];
      if (!t || t.at > end) break;
      timers.shift(); now = t.at; t.fn();
    }
    now = end;
  };
  return { s, socks, states, advance, doc, setVisible(v: DocumentVisibilityState) { doc.visibilityState = v; for (const f of doc.l) f(); } };
}

describe("backoffDelay", () => {
  it("grows exponentially with jitter and caps", () => {
    const c = DEFAULT_STREAM_CONFIG;
    expect(backoffDelay(0, c, () => 0.5)).toBe(1000);
    expect(backoffDelay(3, c, () => 0.5)).toBe(8000);
    expect(backoffDelay(20, c, () => 0.5)).toBe(30000);
    expect(backoffDelay(0, c, () => 0)).toBe(700);
    expect(backoffDelay(0, c, () => 1)).toBe(1300);
  });
});

describe("StateStream", () => {
  it("applies deltas on top of the full frame and hands consumers fresh objects", () => {
    const r = rig(); r.s.start(); const k = r.socks[0]; k.open();
    k.msg({ type: "state", seq: 1, ts: 1, devices: [{ ip: "a", b: 1 }, { ip: "b", b: 2 }] });
    const first = r.states[0];
    k.msg({ type: "delta", seq: 2, base: 1, patch: { $o: { ts: { $r: 2 }, devices: { $a: 2, $i: { "1": { $o: { b: { $r: 9 } } } } } } } });
    expect(r.states[1]).toMatchObject({ type: "state", ts: 2, devices: [{ ip: "a", b: 1 }, { ip: "b", b: 9 }] });
    expect(first).toMatchObject({ ts: 1, devices: [{ b: 1 }, { b: 2 }] }); // previous frame untouched
    const now = r.states[1].devices; const before = first.devices;
    expect(Array.isArray(now) && Array.isArray(before) && now[0] === before[0]).toBe(true); // unchanged subtree shared
  });

  it("an empty delta is a heartbeat, not a re-render", () => {
    const r = rig(); r.s.start(); const k = r.socks[0]; k.open();
    k.msg({ type: "state", seq: 1, a: 1 });
    k.msg({ type: "delta", seq: 2, base: 1, patch: null });
    expect(r.states).toHaveLength(1);
    expect(r.s.lastSeq).toBe(2);
  });

  it("a delta that does not line up asks for a resync", () => {
    const r = rig(); r.s.start(); const k = r.socks[0]; k.open();
    k.msg({ type: "state", seq: 1, a: 1 });
    k.msg({ type: "delta", seq: 5, base: 4, patch: { $o: { a: { $r: 2 } } } });
    expect(k.sent.map((x) => JSON.parse(x).type)).toContain("resync");
    expect(r.states).toHaveLength(1);
  });

  it("legacy backends (full frames, no seq) still work", () => {
    const r = rig(); r.s.start(); const k = r.socks[0]; k.open();
    k.msg({ type: "state", a: 1 }); k.msg({ type: "state", a: 2 });
    expect(r.states.map((m) => m.a)).toEqual([1, 2]);
  });

  it("reconnects with backoff after close, resetting after a good frame", () => {
    const r = rig(); r.s.start(); r.socks[0].open(); r.socks[0].drop();
    r.advance(999); expect(r.socks).toHaveLength(1);
    r.advance(1); expect(r.socks).toHaveLength(2);
    r.socks[1].drop(); r.advance(1999); expect(r.socks).toHaveLength(2);
    r.advance(1); expect(r.socks).toHaveLength(3);
    r.socks[2].open(); r.socks[2].msg({ type: "state", seq: 1 });
    expect(r.s.attempts).toBe(0);
  });

  it("a silent socket is treated as dead after staleMs", () => {
    const r = rig({ staleMs: 5000 }); r.s.start(); const k = r.socks[0]; k.open();
    k.msg({ type: "state", seq: 1 });
    r.advance(4000); k.msg({ type: "delta", seq: 2, base: 1, patch: null });
    r.advance(4000); expect(k.closed).toBe(false);
    r.advance(6000); expect(k.closed).toBe(true);
    r.advance(1000); expect(r.socks).toHaveLength(2);
  });

  it("pauses while hidden (no stale reconnect) and resyncs on return", () => {
    const r = rig(); r.s.start(); const k = r.socks[0]; k.open(); k.msg({ type: "state", seq: 1 });
    r.setVisible("hidden");
    expect(JSON.parse(k.sent.at(-1)!).type).toBe("pause");
    r.advance(60_000); expect(k.closed).toBe(false);
    r.setVisible("visible");
    expect(JSON.parse(k.sent.at(-1)!).type).toBe("resync");
  });

  it("stop() closes without reconnecting", () => {
    const r = rig(); r.s.start(); r.socks[0].open(); r.s.stop(); r.advance(60_000);
    expect(r.socks).toHaveLength(1);
  });
});

describe("applyPatch", () => {
  it("handles deletes, resizes and replace", () => {
    expect(applyPatch({ a: 1, b: 2 }, { $o: { c: { $r: 3 } }, $d: ["a"] })).toEqual({ b: 2, c: 3 });
    expect(applyPatch([1, 2, 3], { $a: 1, $i: {} })).toEqual([1]);
    expect(applyPatch([1], { $a: 3, $i: { "2": { $r: 7 } } })).toEqual([1, null, 7]);
    expect(applyPatch({ x: 1 }, null)).toEqual({ x: 1 });
  });
});
