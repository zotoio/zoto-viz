/** Whether mosaic layout sync should rebuild the view drawer (main `applyMode` + anim sync). */
export function shouldRebindViewDrawerOnApplyMode(flags: { keepLayout?: boolean }): boolean {
  return !flags.keepLayout;
}

export function rebindViewDrawerOnApplyMode(
  bindThisView: (modeId: string) => void,
  modeId: string,
  flags: { keepLayout?: boolean },
): void {
  if (shouldRebindViewDrawerOnApplyMode(flags)) bindThisView(modeId);
}
