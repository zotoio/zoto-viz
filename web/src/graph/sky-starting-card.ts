/**
 * "<View> · Starting…" while a view's own sky is fetched and compiled. Without it a pack-sky
 * tile is plain theme background for as long as the compile takes (60s on a software renderer),
 * which reads as a blank tile. The card fades out once the sky is on screen.
 *
 * The card never writes `data-view-state` itself: the tile's ViewState (`app/view-state`) stamps
 * the tile, this card and any notice with one value.
 */
export const SKY_STARTING_CLASS = "sky-starting-card";
const FADE_MS = 400;

export function skyStartingText(name: string): string {
  return `${name} · Starting…`;
}

export function showSkyStartingCard(host: HTMLElement | null, name: string): void {
  if (!host) return;
  let card = host.querySelector<HTMLElement>(`:scope > .${SKY_STARTING_CLASS}`);
  if (!card) {
    card = document.createElement("div");
    card.className = SKY_STARTING_CLASS;
    const label = document.createElement("span");
    label.className = "sky-starting-name";
    card.appendChild(label);
    host.appendChild(card);
  }
  card.classList.remove("fading");
  card.querySelector(".sky-starting-name")!.textContent = skyStartingText(name);
}

/** `fade` when the sky landed; a failed or aborted load removes the card at once. */
export function hideSkyStartingCard(host: HTMLElement | null, fade = true): void {
  const card = host?.querySelector<HTMLElement>(`:scope > .${SKY_STARTING_CLASS}`);
  if (!card) return;
  if (!fade) {
    card.remove();
    return;
  }
  card.classList.add("fading");
  setTimeout(() => {
    if (card.classList.contains("fading")) card.remove();
  }, FADE_MS);
}

/** A card is up and not fading: the tile is starting, not blank. */
export function skyStartingShown(host: ParentNode | null): boolean {
  const card = host?.querySelector<HTMLElement>(`.${SKY_STARTING_CLASS}`);
  return !!card && !card.classList.contains("fading");
}
