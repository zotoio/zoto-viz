import { describe, expect, it, vi } from "vitest";

const SANDBOX_PUBLISH_SURFACE_SDK = `
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

type Sent = { type: string; payload: Record<string, unknown>; transfer?: unknown[] };

function installPublishSurface(createImageBitmap: typeof globalThis.createImageBitmap) {
  const allowed = new Set(["viz.write"]);
  const zoto: { publishSurface?: (canvas: object) => void } = {};
  const sent: Sent[] = [];
  const send = (type: string, payload: Record<string, unknown>, transfer?: unknown[]) => {
    sent.push({ type, payload, transfer });
  };
  const vizAllowed = (cap: string) => allowed.has(cap);
  const win = { __zotoConfig: { pluginId: "pack-x" } };
  const run = new Function(
    "zoto",
    "send",
    "vizAllowed",
    "createImageBitmap",
    "window",
    `${SANDBOX_PUBLISH_SURFACE_SDK}; return zoto.publishSurface;`,
  ) as (
    zoto: object,
    sendFn: typeof send,
    vizAllowedFn: typeof vizAllowed,
    createImageBitmap: typeof globalThis.createImageBitmap,
    window: typeof win,
  ) => (canvas: object) => void;
  const publishSurface = run(zoto, send, vizAllowed, createImageBitmap, win);
  return { publishSurface, sent };
}

describe("sandbox publishSurface", () => {
  it("uses createImageBitmap on an ordinary canvas and transfers the bitmap", async () => {
    const bmp = { width: 4, height: 4, close() {} };
    const createImageBitmap = vi.fn().mockResolvedValue(bmp);
    const { publishSurface, sent } = installPublishSurface(createImageBitmap);
    const canvas = { tagName: "CANVAS" };
    publishSurface(canvas);
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(createImageBitmap).toHaveBeenCalledWith(canvas);
    expect(sent[0]!.type).toBe("publishBitmap");
    expect(sent[0]!.payload.bitmap).toBe(bmp);
    expect(sent[0]!.transfer).toEqual([bmp]);
  });

  it("posts publishBitmapFailed when createImageBitmap rejects", async () => {
    const createImageBitmap = vi.fn().mockRejectedValue(new Error("bitmap fail"));
    const { publishSurface, sent } = installPublishSurface(createImageBitmap);
    publishSurface({});
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.type).toBe("publishBitmapFailed");
  });

  it("prefers transferToImageBitmap when the canvas is an OffscreenCanvas", () => {
    const bmp = { width: 2, height: 2, close() {} };
    const createImageBitmap = vi.fn();
    const { publishSurface, sent } = installPublishSurface(createImageBitmap);
    const canvas = { transferToImageBitmap: () => bmp };
    publishSurface(canvas);
    expect(createImageBitmap).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.type).toBe("publishBitmap");
    expect(sent[0]!.transfer).toEqual([bmp]);
  });
});
