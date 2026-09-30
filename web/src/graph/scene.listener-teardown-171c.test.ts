/**
 * #171 (c): NetScene.dispose() releases every DOM listener the scene added. A hosted scene takes its
 * input on the tile element itself (`inputEl = container`), and that element outlives the scene: the
 * mosaic reuses a pane's `.mosaic-scene` element for the next scene, so a listener the old scene left
 * there would keep steering a disposed camera and picker. The row counts, per target and event type,
 * the listeners added while the scene is built against those released by dispose (removeEventListener
 * with the same listener and capture, or an aborted `signal`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NetScene } from "./scene";
import { RenderHost } from "./render-host";

type Added = { target: unknown; type: string; listener: unknown; capture: boolean; signal: AbortSignal | undefined };

const captureOf = (o: boolean | EventListenerOptions | undefined): boolean => (typeof o === "boolean" ? o : !!o?.capture);

/** The prototype that owns the DOM's addEventListener (happy-dom's EventTarget, not Node's global one). */
function nodeListenerProto(n: Node): EventTarget {
  let p: EventTarget = Object.getPrototypeOf(n);
  while (!Object.prototype.hasOwnProperty.call(p, "addEventListener")) p = Object.getPrototypeOf(p);
  return p;
}

describe("#171 (c): NetScene.dispose releases the listeners it added", () => {
  beforeEach(() => {
    expect.hasAssertions();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it("a hosted scene: after dispose, every listener it added on window, document and its tile element is released (#171 c)", () => {
    const wall = document.createElement("div");
    Object.defineProperty(wall, "clientWidth", { value: 640 });
    Object.defineProperty(wall, "clientHeight", { value: 480 });
    const pane = document.createElement("div");
    Object.defineProperty(pane, "clientWidth", { value: 320 });
    Object.defineProperty(pane, "clientHeight", { value: 240 });
    wall.appendChild(pane);
    document.body.appendChild(wall);
    const host = new RenderHost(wall);

    const added: Added[] = [];
    const removed: Omit<Added, "signal">[] = [];
    // Nodes share one prototype's methods; window's are its own (vitest copies them onto the global).
    const proto = nodeListenerProto(pane);
    const adds = [vi.spyOn(proto, "addEventListener"), vi.spyOn(window, "addEventListener")];
    const removes = [vi.spyOn(proto, "removeEventListener"), vi.spyOn(window, "removeEventListener")];
    const scene = new NetScene(pane, { satellite: true, host, tileId: "pane-a" });
    for (const add of adds) {
      add.mock.calls.forEach(([type, listener, opts], i) => {
        added.push({ target: add.mock.contexts[i], type, listener, capture: captureOf(opts), signal: typeof opts === "object" ? opts.signal : undefined });
      });
    }
    const addsBeforeDispose = added.length;
    scene.dispose();
    for (const remove of removes) {
      remove.mock.calls.forEach(([type, listener, opts], i) => {
        removed.push({ target: remove.mock.contexts[i], type, listener, capture: captureOf(opts) });
      });
    }

    const label = (t: unknown): string => (t === window ? "window" : t === document ? "document" : t === pane ? "tile" : "other");
    const outlives = new Set(["window", "document", "tile"]);
    const tally = new Map<string, { added: number; released: number }>();
    for (const a of added) {
      const where = label(a.target);
      if (!outlives.has(where)) continue;
      const key = `${where}:${a.type}`;
      const row = tally.get(key) ?? { added: 0, released: 0 };
      row.added++;
      const released = a.signal?.aborted === true
        || removed.some((r) => r.target === a.target && r.type === a.type && r.listener === a.listener && r.capture === a.capture);
      if (released) row.released++;
      tally.set(key, row);
    }
    const unbalanced = [...tally].filter(([, n]) => n.added !== n.released).map(([k, n]) => `${k} added ${n.added} released ${n.released}`);

    expect(addsBeforeDispose, "the scene added DOM listeners while it was built").toBeGreaterThan(0);
    expect(tally.get("tile:pointerdown")?.added, "the tile element carries the scene's pointer input").toBeGreaterThan(0);
    expect(unbalanced, "listeners still attached after dispose (target:type)").toEqual([]);
    host.dispose();
  });
});
