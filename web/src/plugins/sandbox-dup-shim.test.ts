import { afterEach, describe, expect, it, vi } from "vitest";
import { SANDBOX_DUPLICATE_TILE_SHIM } from "./sandbox-shim";

function installDupShim() {
  const posted: { type: string }[] = [];
  const zoto: Record<string, unknown> = {};
  (globalThis as { zoto?: unknown }).zoto = zoto;
  (globalThis as { parent?: { postMessage: (msg: { type: string }) => void } }).parent = {
    postMessage: (msg) => { posted.push(msg); },
  };
  const surface = {
    width: 4,
    height: 4,
    transferToImageBitmap: () => ({ width: 4, height: 4, close() {} }),
    setAttribute: vi.fn(),
  };
  vi.spyOn(document, "createElement").mockReturnValue(surface as HTMLCanvasElement);
  vi.spyOn(document.body, "appendChild").mockImplementation(() => surface as HTMLCanvasElement);
  const run = new Function(`
const allowed = new Set(["viz.write"]);
${SANDBOX_DUPLICATE_TILE_SHIM}
`) as () => void;
  run();
  return { zoto, posted };
}

describe("sandbox duplicate-tile shim", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as { zoto?: unknown }).zoto;
  });

  it("does not publish when dupTiles < 2", () => {
    const { zoto, posted } = installDupShim();
    (zoto as { onFrame?: (f: unknown) => void }).onFrame = () => {};
    (zoto as { onFrame?: (f: unknown) => void }).onFrame?.({});
    expect(posted).toHaveLength(0);
  });

  it("publishes after onFrame when dupTiles >= 2", () => {
    const { zoto, posted } = installDupShim();
    window.dispatchEvent(new MessageEvent("message", {
      data: { source: "zoto-viz-host", type: "dupTiles", count: 2 },
    }));
    (zoto as { onFrame?: (f: unknown) => void }).onFrame = () => {};
    (zoto as { onFrame?: (f: unknown) => void }).onFrame?.({});
    expect(posted.some((p) => p.type === "publishBitmap")).toBe(true);
  });
});
