import { afterEach, describe, expect, it, vi } from "vitest";
import { hideSkyStartingCard, showSkyStartingCard, skyStartingShown, skyStartingText } from "./sky-starting-card";

describe("sky Starting card", () => {
  afterEach(() => vi.useRealTimers());

  it("shows the view name while its sky starts, fades once it lands, and is not counted as blank", () => {
    vi.useFakeTimers();
    const pane = document.createElement("div");
    showSkyStartingCard(pane, "Backrooms");
    const card = pane.querySelector<HTMLElement>(".sky-starting-card")!;
    expect(card.textContent).toBe(skyStartingText("Backrooms"));
    expect(card.textContent).toBe("Backrooms · Starting…");
    expect(card.dataset.viewState).toBe("starting");
    expect(skyStartingShown(pane)).toBe(true);
    showSkyStartingCard(pane, "Backrooms");
    expect(pane.querySelectorAll(".sky-starting-card").length).toBe(1);

    hideSkyStartingCard(pane, true);
    expect(skyStartingShown(pane)).toBe(false);
    expect(card.classList.contains("fading")).toBe(true);
    vi.advanceTimersByTime(500);
    expect(pane.querySelector(".sky-starting-card")).toBeNull();
  });

  it("a restart during the fade keeps the card; a failed load removes it at once", () => {
    vi.useFakeTimers();
    const pane = document.createElement("div");
    showSkyStartingCard(pane, "Backrooms");
    hideSkyStartingCard(pane, true);
    showSkyStartingCard(pane, "Backrooms");
    vi.advanceTimersByTime(500);
    expect(skyStartingShown(pane)).toBe(true);
    hideSkyStartingCard(pane, false);
    expect(pane.querySelector(".sky-starting-card")).toBeNull();
  });
});
