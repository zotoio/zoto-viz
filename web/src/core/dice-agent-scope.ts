import {
  clearSession,
  setAt,
  writeSession,
  type ScopeStore,
  type ScopeValue,
} from "./settings-scope";
import { agentChangeLine } from "./scope-copy";
import { stripMosaicLayout } from "../ui/capture";
import type { DreamAnim } from "../graph/scene";

export type DiceScope = "session" | "wall";
export type AgentScope = "session" | "view" | "global";

export const DICE_SCOPE_KEY = "zoto-viz.diceScope";
export const AGENT_SCOPE_KEY = "zoto-viz.agentScope";

export function loadDiceScope(store: Pick<Storage, "getItem"> | null = defaultStore()): DiceScope {
  return store?.getItem(DICE_SCOPE_KEY) === "wall" ? "wall" : "session";
}

export function loadAgentScope(store: Pick<Storage, "getItem"> | null = defaultStore()): AgentScope {
  const raw = store?.getItem(AGENT_SCOPE_KEY);
  if (raw === "session" || raw === "global") return raw;
  return "view";
}

export function saveDiceScope(scope: DiceScope, store: Pick<Storage, "setItem" | "removeItem"> | null = defaultStore()): void {
  if (!store) return;
  if (scope === "session") store.removeItem(DICE_SCOPE_KEY);
  else store.setItem(DICE_SCOPE_KEY, scope);
}

export function saveAgentScope(scope: AgentScope, store: Pick<Storage, "setItem" | "removeItem"> | null = defaultStore()): void {
  if (!store) return;
  if (scope === "view") store.removeItem(AGENT_SCOPE_KEY);
  else store.setItem(AGENT_SCOPE_KEY, scope);
}

function defaultStore(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** A session roll lives above the tile and is gone when the session bag is cleared. */
export function applyDiceChange(
  store: ScopeStore,
  scope: DiceScope,
  key: string,
  value: ScopeValue,
  wallId: string,
): ScopeStore {
  if (scope === "session") return writeSession(store, key, value);
  const wrote = setAt(store, "wall", key, value, { packId: "", viewId: "", wallId, tileId: "" });
  return wrote.store;
}

export function reloadDice(store: ScopeStore): ScopeStore {
  return clearSession(store);
}

export function applyAgentChange(
  store: ScopeStore,
  scope: AgentScope,
  key: string,
  value: ScopeValue,
  ctx: { viewId: string; wallId: string; tileId: string; packId: string },
): ScopeStore {
  if (scope === "session") return writeSession(store, key, value);
  const level = scope === "global" ? "global" : "view";
  const wrote = setAt(store, level, key, value, ctx);
  return wrote.store;
}

export function agentWroteGlobal(before: ScopeStore, after: ScopeStore, key: string): boolean {
  return before.global[key] !== after.global[key] && Object.prototype.hasOwnProperty.call(after.global, key);
}

/** The layout lock strips mosaic layout at every agent scope. */
export function agentAnimForScope(
  anim: Partial<DreamAnim> | undefined,
  layoutAllowed: boolean,
): Partial<DreamAnim> | undefined {
  if (!anim) return anim;
  if (layoutAllowed) return anim;
  return stripMosaicLayout(anim);
}

export { agentChangeLine };
