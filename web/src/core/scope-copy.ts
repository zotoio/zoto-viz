/** Signed sentences for scope, walls, dice, agent, and source hosts. */

export function fromLevelStatus(level: string, value: string): string {
  return `From ${level} (${value})`;
}

export const SET_HERE = "Set here";
export const GLOBAL_ONLY = "Global only";
export const PACK_DEFAULT = "Pack default";

export function resetName(field: string, level: string, value: string): string {
  return `Reset ${field} to ${level} value, ${value}`;
}

export const SEPARATE_TILE = "Separate this tile";
export const TILE_OWN_SETTINGS = "This tile has its own settings";

export function shareWithPack(pack: string): string {
  return `Share with other ${pack} tiles`;
}

export function overrideWarning(n: number, field: string): string {
  return `${n} views or tiles set their own ${field}, so they won't change.`;
}

export const SHOW_OVERRIDES = "Show";

export function applyAllConfirm(tiles: number, views: number, field: string): string {
  return `${tiles} tiles and ${views} views set their own ${field}. Clear them?`;
}

export const CLEAR_AND_APPLY = "Clear and apply";
export const KEEP_THEIRS = "Keep theirs";

export const DICE_CHANGES = "Dice changes";
export const THIS_SESSION_ONLY = "This session only";
export const SAVE_TO_THIS_WALL = "Save to this wall";

export const AGENT_CHANGES = "Agent changes";
export const SAVE_TO_THIS_VIEW = "Save to this view";
export const SAVE_EVERYWHERE = "Save everywhere";

export function agentChangeLine(field: string, scope: "session" | "view" | "global", tileLabel = ""): string {
  if (scope === "session" && tileLabel) return `Changed ${field} for ${tileLabel} (this session only).`;
  if (scope === "session") return `Changed ${field} (this session only).`;
  if (scope === "view") return `Changed ${field} for this view.`;
  return `Changed ${field} everywhere.`;
}

export function sourceConsentPrompt(view: string, host: string): string {
  return `${view} wants to load data from ${host}.`;
}

export const ALLOW_HOST = "Allow";
export const NOT_NOW = "Not now";
export const REMOVE_HOST = "Remove";

export const SAVE_WALL_AS = "Save wall as…";
export const RENAME_WALL = "Rename";
export const DELETE_WALL = "Delete";
export const DEFAULT_WALL_NAME = "Default";

export function deleteWallConfirm(name: string): string {
  return `Delete ${name}?`;
}
