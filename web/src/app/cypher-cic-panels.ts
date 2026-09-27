/** Saved feed/chat visibility while cypher-cic is active (session-only; never persisted). */
export interface CypherCicPanelSession {
  feedOn: boolean;
  chatOn: boolean;
}

export type CypherCicPanelSessionHolder = {
  session: CypherCicPanelSession | null;
};

/** View shape needed to enter/leave cypher-cic panel session (matches {@link ViewMode}). */
export type CypherCicPanelMode = { pluginId?: string };

/** Same entry/leave behaviour as `main.ts` `applyCypherCicPanelSession`. */
export function applyCypherCicPanelSession(
  holder: CypherCicPanelSessionHolder,
  settings: {
    feedSettings: { on: boolean };
    chatSettings: { on: boolean };
    setCypherCicPanelCollapsed: (v: boolean) => void;
    setFeedOn: (on: boolean, opts?: { persist?: boolean }) => void;
    setChatOn: (on: boolean, opts?: { persist?: boolean }) => void;
    readPersistedFeedOn: () => boolean;
    readPersistedChatOn: () => boolean;
  },
  mode: CypherCicPanelMode,
): void {
  if (mode.pluginId !== "cypher-cic") {
    const end = endCypherCicPanelSession(holder.session);
    if (end) {
      settings.setCypherCicPanelCollapsed(false);
      settings.setFeedOn(settings.readPersistedFeedOn(), { persist: false });
      settings.setChatOn(settings.readPersistedChatOn(), { persist: false });
      holder.session = null;
    }
    return;
  }
  const begin = beginCypherCicPanelSession(
    holder.session,
    settings.feedSettings.on,
    settings.chatSettings.on,
  );
  holder.session = begin.session;
  settings.setCypherCicPanelCollapsed(true);
  if (begin.hideFeed) settings.setFeedOn(false, { persist: false });
  if (begin.hideChat) settings.setChatOn(false, { persist: false });
}

/** Production header `f` / `F` handler (`main.ts` keydown). */
export function applyProductionFeedHeaderToggle(settings: {
  feedSettings: { on: boolean };
  setFeedOn: (on: boolean, opts?: { persist?: boolean }) => void;
}): void {
  settings.setFeedOn(!settings.feedSettings.on);
}

/** Production header `c` / `C` handler (`main.ts` keydown). */
export function applyProductionChatHeaderToggle(settings: {
  chatSettings: { on: boolean };
  setChatOn: (on: boolean, opts?: { persist?: boolean }) => void;
}): void {
  settings.setChatOn(!settings.chatSettings.on);
}

/** Entering cypher-cic: remember user prefs and hide panels without writing localStorage. */
export function beginCypherCicPanelSession(
  session: CypherCicPanelSession | null,
  feedOn: boolean,
  chatOn: boolean,
): { session: CypherCicPanelSession; hideFeed: boolean; hideChat: boolean } {
  if (session) return { session, hideFeed: false, hideChat: false };
  const next = { feedOn, chatOn };
  return {
    session: next,
    hideFeed: feedOn,
    hideChat: chatOn,
  };
}

/** Leaving cypher-cic: restore panel visibility from the session snapshot. */
export function endCypherCicPanelSession(
  session: CypherCicPanelSession | null,
): { session: null; restoreFeed: boolean; restoreChat: boolean } | null {
  if (!session) return null;
  return {
    session: null,
    restoreFeed: session.feedOn,
    restoreChat: session.chatOn,
  };
}
