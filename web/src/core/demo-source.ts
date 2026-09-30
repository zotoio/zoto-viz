/** Shared demo / host-idle copy (#43 imports the same constants). */
export const DEMO_DATA_LABEL = "Demo data";
export const DEMO_DATA_SOURCE = "idle: fixture: host";
export const DEMO_LABEL_CLASS = "tetris-idle-label";

/** #182: the cue after an arcade HUD's rate while it counts demo rows (`12 pkt/s · demo`), on the badge's own flag. */
export const DEMO_RATE_CUE = "demo";

/**
 * #182: an arcade idle feed's badge turned on or off (or changed its text). Dispatched on `document`, so the feed
 * panel's status line follows the badge without importing the arcade code.
 */
export const ARCADE_DEMO_EVENT = "zoto-viz:arcade-demo";
export interface ArcadeDemoDetail {
  /** the demo badge is visible: demo rows are on the board */
  showing: boolean;
  /** the badge text while showing ("" when not) */
  text: string;
}
