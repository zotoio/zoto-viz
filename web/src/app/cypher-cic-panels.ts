/** Saved feed/chat visibility while cypher-cic is active (session-only; never persisted). */
export interface CypherCicPanelSession {
  feedOn: boolean;
  chatOn: boolean;
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
