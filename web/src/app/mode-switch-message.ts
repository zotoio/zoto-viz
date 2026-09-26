const DISMISS_MS = 5000;
let dismissTimer: ReturnType<typeof setTimeout> | undefined;
let statusEl: HTMLElement | null = null;

function liveStatusEl(): HTMLElement | null {
  if (statusEl?.isConnected) return statusEl;
  statusEl = document.getElementById("modeSwitchStatus");
  return statusEl;
}

/** Create once at startup — visually hidden but not `display:none` so assistive tech can read updates. */
export function initModeSwitchStatusStrip(): HTMLElement {
  const el = ensureModeSwitchStatusEl();
  el.hidden = false;
  el.setAttribute("aria-hidden", "true");
  el.classList.add("mode-switch-status--idle");
  el.textContent = "";
  return el;
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
    document.body.appendChild(statusEl);
  }
  return statusEl;
}

export function clearModeSwitchStatus(): void {
  const el = liveStatusEl();
  if (!el) return;
  if (dismissTimer) clearTimeout(dismissTimer);
  dismissTimer = undefined;
  el.textContent = "";
  el.classList.remove("morphing");
  delete el.dataset.morphTo;
  el.classList.add("mode-switch-status--idle");
  el.setAttribute("aria-hidden", "true");
}

export function showModeSwitchStatus(message: string): string {
  const el = ensureModeSwitchStatusEl();
  if (dismissTimer) clearTimeout(dismissTimer);
  el.replaceChildren();
  el.append(document.createTextNode(message));
  el.classList.remove("mode-switch-status--idle", "morphing");
  el.removeAttribute("aria-hidden");
  delete el.dataset.morphTo;
  dismissTimer = setTimeout(() => clearModeSwitchStatus(), DISMISS_MS);
  return message;
}

/** User declined consent — quiet rollback. */
export function flashModeKeptPrevious(keptLabel: string): string {
  return showModeSwitchStatus(`Kept ${keptLabel}`);
}

/** Consent API / load failure. */
export function flashModeLoadFailed(
  declinedLabel: string,
  keptLabel: string,
  onTryAgain?: () => void,
): string {
  const el = ensureModeSwitchStatusEl();
  if (dismissTimer) clearTimeout(dismissTimer);
  el.replaceChildren();
  el.append(document.createTextNode(`Couldn't load ${declinedLabel}, kept ${keptLabel}`));
  if (onTryAgain) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn mode-switch-retry";
    btn.textContent = "Try again";
    btn.addEventListener("click", () => {
      clearModeSwitchStatus();
      onTryAgain();
    });
    el.append(document.createTextNode(" "));
    el.append(btn);
  }
  el.classList.remove("mode-switch-status--idle", "morphing");
  el.removeAttribute("aria-hidden");
  dismissTimer = setTimeout(() => clearModeSwitchStatus(), DISMISS_MS);
  return el.textContent ?? "";
}

/** Tests: status strip is actually shown (not `#foot` / hint morph). */
export function isModeSwitchStatusVisible(): boolean {
  const el = liveStatusEl();
  if (!el || el.classList.contains("mode-switch-status--idle")) return false;
  if (el.classList.contains("morphing")) return false;
  const cs = getComputedStyle(el);
  const op = cs.opacity;
  const opacityOk = op === "" || Number(op) > 0.01;
  return cs.display !== "none" && cs.visibility !== "hidden" && opacityOk;
}
