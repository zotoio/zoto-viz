import { afterEach, describe, expect, it, vi } from "vitest";

function mockCapture(getUserMedia: unknown) {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: { query: vi.fn(async () => ({ state: "prompt" })) },
  });
}

async function importMediaAsk() {
  return import("./media-ask");
}

async function reloadMediaAsk() {
  vi.resetModules();
  return import("./media-ask");
}

async function waitForDialog() {
  await vi.waitFor(() => {
    expect(document.querySelector("[data-media-ask]") !== null).toBe(true);
  });
}

function clickNotNow() {
  const cancel = document.querySelector<HTMLButtonElement>("[data-media-ask] .btn:not(.primary)");
  cancel!.click();
}

describe("media ask dismiss sessionStorage", () => {
  afterEach(async () => {
    vi.resetModules();
    const mod = await importMediaAsk();
    mod.resetMediaAsk();
    sessionStorage.clear();
    const { liveCam } = await import("../camera/livecam");
    liveCam.setPolicy("off", false);
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("persists mic dismiss so a reload does not reopen the dialog", async () => {
    expect.hasAssertions();
    mockCapture(vi.fn(async () => ({ getTracks: () => [] })));
    const mod = await importMediaAsk();
    const pending = mod.askUserMedia({ audio: true, video: false }, "watchword listening");
    await waitForDialog();
    clickNotNow();
    await expect(pending).resolves.toBeNull();
    expect(sessionStorage.getItem("zoto-viz.mediaDismiss")).toBe('{"mic":true}');

    const reloaded = await reloadMediaAsk();
    mockCapture(vi.fn(async () => ({ getTracks: () => [] })));
    const again = reloaded.askUserMedia({ audio: true, video: false }, "pulse microphone");
    await vi.waitFor(() => {
      expect(document.querySelector("[data-media-ask]") === null).toBe(true);
    });
    await expect(again).resolves.toBeNull();
  });

  it("clears session dismiss so re-ask after reload can reopen the dialog", async () => {
    expect.hasAssertions();
    mockCapture(vi.fn(async () => ({ getTracks: () => [] })));
    const mod = await importMediaAsk();
    const pending = mod.askUserMedia({ audio: true, video: false }, "watchword listening");
    await waitForDialog();
    clickNotNow();
    await expect(pending).resolves.toBeNull();

    const afterReload = await reloadMediaAsk();
    mockCapture(vi.fn(async () => ({ getTracks: () => [] })));
    const blocked = afterReload.askUserMedia({ audio: true, video: false }, "pulse microphone");
    await vi.waitFor(() => {
      expect(document.querySelector("[data-media-ask]") === null).toBe(true);
    });
    await expect(blocked).resolves.toBeNull();

    afterReload.clearMediaDismiss("mic");
    expect(sessionStorage.getItem("zoto-viz.mediaDismiss")).toBeNull();

    const cleared = await reloadMediaAsk();
    mockCapture(vi.fn(async () => ({ getTracks: () => [] })));
    cleared.askUserMedia({ audio: true, video: false }, "watchword listening");
    await waitForDialog();
  });

  it("keeps camera ask available after mic dismiss across a reload", async () => {
    expect.hasAssertions();
    mockCapture(vi.fn(async () => ({ getTracks: () => [] })));
    const { liveCam } = await import("../camera/livecam");
    liveCam.setPolicy("auto", false);
    const mod = await importMediaAsk();
    const micPending = mod.askUserMedia({ audio: true, video: false }, "watchword listening");
    await waitForDialog();
    clickNotNow();
    await expect(micPending).resolves.toBeNull();

    const reloaded = await reloadMediaAsk();
    mockCapture(vi.fn(async () => ({ getTracks: () => [] })));
    const camLive = await import("../camera/livecam");
    camLive.liveCam.setPolicy("auto", false);
    const camPending = reloaded.askUserMedia(
      { audio: false, video: { facingMode: "user" } },
      "live camera",
    );
    await vi.waitFor(() => {
      expect(document.querySelector("[data-media-ask]") !== null).toBe(true);
    });
    expect(document.querySelector("[data-media-ask] strong")?.textContent).toBe("Allow the camera");
    clickNotNow();
    await expect(camPending).resolves.toBeNull();
  });
});
