import { viewSelectOptions } from "../plugins/plugin";

/** Digit keys 1–9 and 0 (tenth slot) → catalog mode id, matching main keydown → applyMode. */
export function modeForDigitKey(key: string): string | null {
  const idx = key === "0" ? 9 : Number(key) - 1;
  const modes = viewSelectOptions();
  if (idx >= 0 && idx < modes.length) return modes[idx]!.value;
  return null;
}
