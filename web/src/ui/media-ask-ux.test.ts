import { afterEach, describe, expect, it, vi } from "vitest";
import { liveCam } from "../camera/livecam";
import { liveMic } from "../audio/want";
import { Settings } from "./settings";
import { AgentPanel } from "./agent";
import { askUserMedia, resetMediaAsk } from "./media-ask";

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

describe("media ask UX", () => {
  afterEach(() => {
    resetMediaAsk();
    sessionStorage.clear();
    liveMic.setPolicy("auto", false);
    liveCam.setPolicy("off", false);
    document.body.innerHTML = "";
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("reload paths", () => {
    afterEach(() => {
      vi.resetModules();
    });

    it("shows the dialog again after resetMediaAsk and a module reload", async () => {
    expect.hasAssertions();
    mockCapture(vi.fn(async () => ({ getTracks: () => [] })));
    const pending = askUserMedia({ audio: true, video: false }, "watchword listening");
    await waitForDialog();
    document.querySelector<HTMLButtonElement>("[data-media-ask] .btn:not(.primary)")!.click();
    await expect(pending).resolves.toBeNull();

    resetMediaAsk();
    const reloaded = await reloadMediaAsk();
    mockCapture(vi.fn(async () => ({ getTracks: () => [] })));
    reloaded.askUserMedia({ audio: true, video: false }, "pulse microphone");
    await waitForDialog();
  });

    it("reopens the mic ask after Settings setMicPolicy auto and a reload", async () => {
    expect.hasAssertions();
    mockCapture(vi.fn(async () => ({ getTracks: () => [] })));
    const pending = askUserMedia({ audio: true, video: false }, "watchword listening");
    await waitForDialog();
    document.querySelector<HTMLButtonElement>("[data-media-ask] .btn:not(.primary)")!.click();
    await expect(pending).resolves.toBeNull();

    const settings = new Settings({ storePrefix: "zoto-viz-media-ask-ux", onChange: () => {} });
    settings.setMicPolicy("auto");

    const reloaded = await reloadMediaAsk();
    mockCapture(vi.fn(async () => ({ getTracks: () => [] })));
    reloaded.askUserMedia({ audio: true, video: false }, "pulse microphone");
    await waitForDialog();
  });

    it("reopens the mic ask after enabling agent listen and a reload", async () => {
    expect.hasAssertions();
    mockCapture(vi.fn(async () => ({ getTracks: () => [] })));
    const pending = askUserMedia({ audio: true, video: false }, "watchword listening");
    await waitForDialog();
    document.querySelector<HTMLButtonElement>("[data-media-ask] .btn:not(.primary)")!.click();
    await expect(pending).resolves.toBeNull();

    const panel = new AgentPanel();
    document.body.append(panel.el);
    const listenInput = [...panel.el.querySelectorAll("input[type=checkbox]")].find((el) => {
      const row = el.closest(".toggle");
      return row?.textContent?.includes("listen for watchword");
    }) as HTMLInputElement;
    listenInput.checked = false;
    listenInput.dispatchEvent(new Event("change", { bubbles: true }));
    listenInput.checked = true;
    listenInput.dispatchEvent(new Event("change", { bubbles: true }));

    const reloaded = await reloadMediaAsk();
    mockCapture(vi.fn(async () => ({ getTracks: () => [] })));
    reloaded.askUserMedia({ audio: true, video: false }, "pulse microphone");
    await waitForDialog();
    });
  });

  it("treats a backdrop click like Not now", async () => {
    expect.hasAssertions();
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [] }));
    mockCapture(getUserMedia);
    const pending = askUserMedia({ audio: true, video: false }, "watchword listening");
    await waitForDialog();
    const dialog = document.querySelector<HTMLDialogElement>("[data-media-ask]")!;
    dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await expect(pending).resolves.toBeNull();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(dialog.returnValue).toBe("not-now");
    await expect(askUserMedia({ audio: true, video: false }, "again")).resolves.toBeNull();
  });

  it("runs capture only after close with returnValue allow", async () => {
    expect.hasAssertions();
    const stream = { getTracks: () => [] } as MediaStream;
    const getUserMedia = vi.fn(async () => stream);
    mockCapture(getUserMedia);
    const pending = askUserMedia({ audio: true, video: false }, "watchword listening");
    await waitForDialog();
    const dialog = document.querySelector<HTMLDialogElement>("[data-media-ask]")!;
    document.querySelector<HTMLButtonElement>("[data-media-ask] .btn.primary")!.click();
    expect(dialog.returnValue).toBe("allow");
    await expect(pending).resolves.toBe(stream);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(document.querySelector("[data-media-ask]")).toBeNull();
  });

  it("records dismiss once when Not now closes the dialog", async () => {
    expect.hasAssertions();
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    mockCapture(vi.fn(async () => ({ getTracks: () => [] })));
    const pending = askUserMedia({ audio: true, video: false }, "watchword listening");
    await waitForDialog();
    document.querySelector<HTMLButtonElement>("[data-media-ask] .btn:not(.primary)")!.click();
    await expect(pending).resolves.toBeNull();
    const dismissWrites = setItem.mock.calls.filter((c) => c[0] === "zoto-viz.mediaDismiss");
    expect(dismissWrites).toHaveLength(1);
    expect(dismissWrites[0][1]).toBe('{"mic":true}');
  });

  it("focuses Allow immediately when the dialog opens", async () => {
    expect.hasAssertions();
    mockCapture(vi.fn(async () => ({ getTracks: () => [] })));
    void askUserMedia({ audio: true, video: false }, "watchword listening");
    await waitForDialog();
    const allow = document.querySelector<HTMLButtonElement>("[data-media-ask] .btn.primary");
    expect(document.activeElement).toBe(allow);
  });

  it("pins the combined microphone and camera heading copy byte-for-byte", async () => {
    expect.hasAssertions();
    const audio = { getTracks: () => [] } as MediaStream;
    const video = { getTracks: () => [] } as MediaStream;
    mockCapture(vi.fn(async (c: MediaStreamConstraints) => (c.audio ? audio : video)));
    liveCam.setPolicy("auto", false);
    const a = askUserMedia({ audio: true, video: false }, "watchword listening");
    const b = askUserMedia({ audio: false, video: { facingMode: "user" } }, "live camera");
    await waitForDialog();
    expect(document.getElementById("media-ask-title")?.textContent).toBe("Allow microphone and camera");
    document.querySelector<HTMLButtonElement>("[data-media-ask] .btn:not(.primary)")!.click();
    await expect(a).resolves.toBeNull();
    await expect(b).resolves.toBeNull();
  });
});
