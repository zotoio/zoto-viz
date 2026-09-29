import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Andrew's rule for the mic: permission is asked once and remembered across reloads,
 * sessions, views, plugins and mosaic tiles. Not now is remembered the same way.
 */

function fakeStream() {
  const track = { readyState: "live" as MediaStreamTrackState, stop: vi.fn() };
  return {
    getTracks: () => [track],
    getAudioTracks: () => [track],
    getVideoTracks: () => [],
  } as unknown as MediaStream;
}

function mockBrowser(getUserMedia: unknown, permission: PermissionState) {
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  Object.defineProperty(navigator, "permissions", {
    configurable: true,
    value: { query: vi.fn(async () => ({ state: permission })) },
  });
}

async function freshPage() {
  vi.resetModules();
  const ask = await import("./media-ask");
  const { liveMic } = await import("../audio/want");
  return { ask, liveMic };
}

function sheet() {
  return document.querySelector<HTMLDialogElement>("[data-media-ask]");
}

async function sheetShown() {
  await vi.waitFor(() => expect(sheet()).toBeTruthy());
}

function press(label: "Allow" | "Not now") {
  [...document.querySelectorAll<HTMLButtonElement>("[data-media-ask] button")]
    .find((b) => b.textContent === label)!.click();
}

describe("mic permission is asked once", () => {
  afterEach(async () => {
    const { ask, liveMic } = await freshPage();
    ask.setMediaDeclineSink(null);
    ask.resetMediaAsk();
    liveMic.setPolicy("auto", false);
    localStorage.clear();
    sessionStorage.clear();
    document.body.innerHTML = "";
    vi.resetModules();
  });

  it("after Allow, a reload opens the watchword mic with no sheet when the browser kept its grant", async () => {
    expect.hasAssertions();
    const first = await freshPage();
    mockBrowser(vi.fn(async () => fakeStream()), "prompt");
    const pending = first.ask.askUserMedia({ audio: true, video: false }, "watchword listening");
    await sheetShown();
    press("Allow");
    await expect(pending).resolves.toBeTruthy();

    const reloaded = await freshPage();
    const stream = fakeStream();
    const getUserMedia = vi.fn(async () => stream);
    mockBrowser(getUserMedia, "granted");
    await expect(reloaded.ask.askUserMedia({ audio: true, video: false }, "watchword listening")).resolves.toBe(stream);
    expect(sheet()).toBeNull();
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });

  it("after Allow, a second plugin and two mosaic tiles asking at once get the mic with no sheet", async () => {
    expect.hasAssertions();
    const first = await freshPage();
    mockBrowser(vi.fn(async () => fakeStream()), "prompt");
    const pending = first.ask.askUserMedia({ audio: true, video: false }, "pulse microphone");
    await sheetShown();
    press("Allow");
    await expect(pending).resolves.toBeTruthy();

    const reloaded = await freshPage();
    const getUserMedia = vi.fn(async () => fakeStream());
    mockBrowser(getUserMedia, "granted");
    const asks = await Promise.all([
      reloaded.ask.askUserMedia({ audio: true, video: false }, "pulse microphone"),
      reloaded.ask.askUserMedia({ audio: true, video: false }, "plugin microphone"),
      reloaded.ask.askUserMedia({ audio: true, video: false }, "tile 2 microphone"),
    ]);
    expect(asks.every(Boolean)).toBe(true);
    expect(sheet()).toBeNull();
    expect(getUserMedia).toHaveBeenCalledTimes(3);
  });

  it("an Allow stored only in the home file also skips the sheet on a new browser", async () => {
    expect.hasAssertions();
    const page = await freshPage();
    page.ask.mergeMediaAccept({ mic: true });
    const getUserMedia = vi.fn(async () => fakeStream());
    mockBrowser(getUserMedia, "prompt");
    await expect(page.ask.askUserMedia({ audio: true, video: false }, "watchword listening")).resolves.toBeTruthy();
    expect(sheet()).toBeNull();
  });

  it("Not now reports a mic decline so the app can turn the header toggle off", async () => {
    expect.hasAssertions();
    const page = await freshPage();
    const declined = vi.fn();
    page.ask.setMediaDeclineSink(declined);
    mockBrowser(vi.fn(async () => fakeStream()), "prompt");
    const pending = page.ask.askUserMedia({ audio: true, video: false }, "watchword listening");
    await sheetShown();
    press("Not now");
    await expect(pending).resolves.toBeNull();
    expect(declined).toHaveBeenCalledTimes(1);
    expect(declined).toHaveBeenCalledWith(["mic"]);
  });

  it("Allow does not report a decline", async () => {
    expect.hasAssertions();
    const page = await freshPage();
    const declined = vi.fn();
    page.ask.setMediaDeclineSink(declined);
    mockBrowser(vi.fn(async () => fakeStream()), "prompt");
    const pending = page.ask.askUserMedia({ audio: true, video: false }, "watchword listening");
    await sheetShown();
    press("Allow");
    await expect(pending).resolves.toBeTruthy();
    expect(declined).not.toHaveBeenCalled();
  });

  it("Not now wired to Settings turns the mic off, and it stays off with no sheet after a reload", async () => {
    expect.hasAssertions();
    const page = await freshPage();
    const { Settings } = await import("./settings");
    const settings = new Settings({ storePrefix: "zoto-viz-mic-once", onChange: () => {} });
    page.ask.setMediaDeclineSink((kinds) => {
      if (kinds.includes("mic")) settings.setMicPolicy("off");
    });
    mockBrowser(vi.fn(async () => fakeStream()), "prompt");
    const pending = page.ask.askUserMedia({ audio: true, video: false }, "watchword listening");
    await sheetShown();
    press("Not now");
    await expect(pending).resolves.toBeNull();
    expect(page.liveMic.micPolicy).toBe("off");
    expect(localStorage.getItem("zoto-viz.mic")).toBe("off");

    const reloaded = await freshPage();
    expect(reloaded.liveMic.micPolicy).toBe("off");
    const getUserMedia = vi.fn(async () => fakeStream());
    mockBrowser(getUserMedia, "prompt");
    await expect(reloaded.ask.askUserMedia({ audio: true, video: false }, "pulse microphone")).resolves.toBeNull();
    expect(sheet()).toBeNull();
    expect(getUserMedia).not.toHaveBeenCalled();
  });
});
