const DISMISS_MS = 5000;
let dismissTimer: ReturnType<typeof setTimeout> | undefined;
let statusEl: HTMLElement | null = null;

function liveStatusEl(): HTMLElement | null {
  if (statusEl?.isConnected) return statusEl;
  statusEl = document.getElementById("modeSwitchStatus");
  return statusEl;
}

export function ensureModeSwitchStatusEl(): HTMLElement {
  const live = liveStatusEl();
  if (live) {
    statusEl = live;
    return live;
  }
  if (!statusEl) {
    statusEl = document.createElement("div");
    statusEl.id = "modeSwitchStatus";
    statusEl.setAttribute("role", "status");
    statusEl.setAttribute("aria-live", "polite");
    statusEl.className = "mode-switch-status";
    statusEl.hidden = true;
    document.body.appendChild(statusEl);
  }
  return statusEl;
}

export function clearModeSwitchStatus(): void {
  const el = liveStatusEl();
  if (!el) return;
  if (dismissTimer) clearTimeout(dismissTimer);
  dismissTimer = undefined;
  el.hidden = true;
  el.textContent = "";
  el.classList.remove("morphing");
  delete el.dataset.morphTo;
}

export function showModeSwitchStatus(message: string): string {
  const el = ensureModeSwitchStatusEl();
  if (dismissTimer) clearTimeout(dismissTimer);
  el.textContent = message;
  el.hidden = false;
  el.classList.remove("morphing");
  delete el.dataset.morphTo;
  dismissTimer = setTimeout(() => clearModeSwitchStatus(), DISMISS_MS);
  return message;
}

/** User declined consent — quiet rollback. */
export function flashModeKeptPrevious(keptLabel: string): string {
  return showModeSwitchStatus(`Kept ${keptLabel}`);
}

/** Consent API / load failure. */
export function flashModeLoadFailed(declinedLabel: string, keptLabel: string): string {
  return showModeSwitchStatus(`Couldn't load ${declinedLabel}, kept ${keptLabel}`);
}

/** Tests: status strip is actually shown (not `#foot` / hint morph). */
export function isModeSwitchStatusVisible(): boolean {
  const el = liveStatusEl();
  if (!el || el.hidden) return false;
  if (el.classList.contains("morphing")) return false;
  const cs = getComputedStyle(el);
  const op = cs.opacity;
  const opacityOk = op === "" || Number(op) > 0.01;
  return cs.display !== "none" && cs.visibility !== "hidden" && opacityOk;
}
