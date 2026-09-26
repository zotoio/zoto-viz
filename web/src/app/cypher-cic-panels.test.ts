import { beforeEach, describe, expect, it } from "vitest";
import { beginCypherCicPanelSession, endCypherCicPanelSession } from "./cypher-cic-panels";

describe("cypher-cic panel session", () => {
  beforeEach(() => expect.hasAssertions());

  it("restores saved feed and chat visibility after leaving the view", () => {
    const enter = beginCypherCicPanelSession(null, true, true);
    expect(enter.hideFeed).toBe(true);
    expect(enter.hideChat).toBe(true);
    const leave = endCypherCicPanelSession(enter.session);
    expect(leave).toEqual({ session: null, restoreFeed: true, restoreChat: true });
  });

  it("does not start a second session while cypher-cic stays active", () => {
    const first = beginCypherCicPanelSession(null, true, false);
    const again = beginCypherCicPanelSession(first.session, false, false);
    expect(again.hideFeed).toBe(false);
    expect(again.hideChat).toBe(false);
    expect(again.session).toBe(first.session);
  });
});
