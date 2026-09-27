import {
  blockedRecordDisplayMessage,
  blockedRetryableEntries,
  packInstallHistory,
  packRetryButtonState,
  submitPackInstallRetry,
} from "./pack-install-retry";
import type { BlockedCatalogEntry } from "./pack-install-surface";

export type BlockedInstallPanelHooks = {
  onCatalogRefresh?: () => void | Promise<void>;
};

export class BlockedInstallPanel {
  readonly el: HTMLElement;
  private listEl: HTMLElement;
  private historyEl: HTMLElement;
  private hooks: BlockedInstallPanelHooks;

  constructor(hooks: BlockedInstallPanelHooks = {}) {
    this.hooks = hooks;
    this.el = document.createElement("div");
    this.el.className = "pack-blocked-install";
    this.el.hidden = true;
    this.listEl = document.createElement("div");
    this.listEl.className = "pack-blocked-install__list";
    this.historyEl = document.createElement("div");
    this.historyEl.className = "pack-blocked-install__history";
    this.el.append(this.listEl, this.historyEl);
  }

  refresh(): void {
    const retryable = blockedRetryableEntries();
    this.el.hidden = retryable.length === 0 && packInstallHistory().length === 0;
    this.listEl.replaceChildren();
    for (const entry of retryable) {
      this.listEl.appendChild(this.renderRow(entry));
    }
    this.historyEl.replaceChildren();
    for (const line of packInstallHistory()) {
      const p = document.createElement("p");
      p.className = "pack-blocked-install__history-line";
      p.textContent = line;
      this.historyEl.appendChild(p);
    }
  }

  private renderRow(entry: BlockedCatalogEntry): HTMLElement {
    const row = document.createElement("div");
    row.className = "pack-blocked-install__row";
    const sha = String(entry.zipSha256 || "");
    const msg = document.createElement("p");
    msg.className = "pack-blocked-install__message";
    msg.textContent = blockedRecordDisplayMessage(entry);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "pack-blocked-install__retry";
    const applyBtn = () => {
      const st = packRetryButtonState(sha);
      btn.disabled = st.disabled;
      btn.textContent = st.label;
    };
    applyBtn();
    btn.addEventListener("click", () => {
      if (packRetryButtonState(sha).disabled) return;
      applyBtn();
      void this.runRetry(sha, applyBtn);
    });
    row.append(msg, btn);
    return row;
  }

  private async runRetry(sha: string, applyBtn: () => void): Promise<void> {
    applyBtn();
    const result = await submitPackInstallRetry(sha);
    applyBtn();
    this.refresh();
    if (result === "success" && this.hooks.onCatalogRefresh) {
      await this.hooks.onCatalogRefresh();
    }
  }
}
