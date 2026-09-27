import { afterEach, describe, expect, it, vi } from "vitest";
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

describe("media ask focus dialog", () => {
  afterEach(() => {
    resetMediaAsk();
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  async function shown() {
    await vi.waitFor(() => {
      expect(document.querySelector("[data-media-ask]")).toBeTruthy();
    });
  }

  it("uses a native dialog labelled by the heading", async () => {
    expect.hasAssertions();
    mockCapture(vi.fn(async () => ({ getTracks: () => [] })));
    void askUserMedia({ audio: true, video: false }, "watchword listening");
    await shown();
    const dialog = document.querySelector<HTMLDialogElement>("[data-media-ask]");
    expect(dialog?.tagName).toBe("DIALOG");
    expect(dialog?.open).toBe(true);
    expect(dialog?.getAttribute("aria-labelledby")).toBe("media-ask-title");
    expect(document.getElementById("media-ask-title")?.textContent).toBe("Allow the microphone");
  });

  it("pins the microphone heading copy byte-for-byte", async () => {
    expect.hasAssertions();
    mockCapture(vi.fn(async () => ({ getTracks: () => [] })));
    void askUserMedia({ audio: true, video: false }, "watchword listening");
    await shown();
    expect(document.getElementById("media-ask-title")?.textContent).toBe("Allow the microphone");
  });

  it("pins the Allow button label", async () => {
    expect.hasAssertions();
    mockCapture(vi.fn(async () => ({ getTracks: () => [] })));
    void askUserMedia({ audio: true, video: false }, "watchword listening");
    await shown();
    const allow = document.querySelector<HTMLButtonElement>("[data-media-ask] .btn.primary");
    expect(allow?.textContent).toBe("Allow");
  });

  it("pins the Not now button label", async () => {
    expect.hasAssertions();
    mockCapture(vi.fn(async () => ({ getTracks: () => [] })));
    void askUserMedia({ audio: true, video: false }, "watchword listening");
    await shown();
    const cancel = document.querySelector<HTMLButtonElement>("[data-media-ask] .btn:not(.primary)");
    expect(cancel?.textContent).toBe("Not now");
  });

  it("pins the embedded-shell body copy", async () => {
    expect.hasAssertions();
    mockCapture(vi.fn(async () => ({ getTracks: () => [] })));
    void askUserMedia({ audio: true, video: false }, "watchword listening");
    await shown();
    const body = document.querySelector("[data-media-ask] .ask-body");
    const paragraphs = [...body?.querySelectorAll("p") ?? []].map((p) => p.textContent ?? "");
    expect(paragraphs[0]).toBe("This window needs the microphone (watchword listening and the pulse). The OS microphone light stays off until you accept.");
    expect(paragraphs[1]).toBe("This embedded browser cannot show the usual listening / camera prompt. Allow here is the accept. If nothing happens, open the monitor in Chromium on localhost.");
  });

  it("closes on Escape without calling getUserMedia and dismisses like Not now", async () => {
    expect.hasAssertions();
    const getUserMedia = vi.fn(async () => ({ getTracks: () => [] }));
    mockCapture(getUserMedia);
    const pending = askUserMedia({ audio: true, video: false }, "watchword listening");
    await shown();
    const dialog = document.querySelector<HTMLDialogElement>("[data-media-ask]")!;
    dialog.close();
    await vi.waitFor(() => {
      expect(document.querySelector("dialog") === null).toBe(true);
    });
    await expect(pending).resolves.toBeNull();
    expect(getUserMedia).not.toHaveBeenCalled();
    await expect(askUserMedia({ audio: true, video: false }, "pulse microphone")).resolves.toBeNull();
  });

  it("returns focus to the header mic toggle on a fresh load after close", async () => {
    expect.hasAssertions();
    document.body.innerHTML = "<input type=\"checkbox\" id=\"mic\" /><div id=\"wall\"></div>";
    mockCapture(vi.fn(async () => ({ getTracks: () => [] })));
    const pending = askUserMedia({ audio: true, video: false }, "watchword listening");
    await shown();
    const cancel = document.querySelector<HTMLButtonElement>("[data-media-ask] .btn:not(.primary)")!;
    cancel.click();
    await pending;
    expect(document.activeElement?.id).toBe("mic");
  });

  it("returns focus to the element that had it before open when still connected", async () => {
    expect.hasAssertions();
    document.body.innerHTML = "<button type=\"button\" id=\"prior\">Prior</button><input type=\"checkbox\" id=\"mic\" />";
    const prior = document.getElementById("prior") as HTMLButtonElement;
    prior.focus();
    mockCapture(vi.fn(async () => ({ getTracks: () => [] })));
    const pending = askUserMedia({ audio: true, video: false }, "watchword listening");
    await shown();
    document.querySelector<HTMLButtonElement>("[data-media-ask] .btn:not(.primary)")!.click();
    await pending;
    expect(document.activeElement?.id).toBe("prior");
  });
});
