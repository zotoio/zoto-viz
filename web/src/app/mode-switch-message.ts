/** User-visible feedback when a view/pack switch is rolled back. */
export function flashModeLoadKeptPrevious(declinedLabel: string, keptLabel: string): string {
  const msg = `Couldn't load ${declinedLabel}, kept ${keptLabel}`;
  const hint = document.getElementById("hint");
  if (hint) {
    delete hint.dataset.morphTo;
    hint.classList.remove("morphing");
    hint.textContent = msg;
  }
  return msg;
}
