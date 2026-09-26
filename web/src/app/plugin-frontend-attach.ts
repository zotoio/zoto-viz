/** Reset pending sandbox config before loading a new plugin frontend bundle. */
export async function attachPluginFrontendAfterConfigReset(
  batcher: { reset(): void },
  attach: () => Promise<unknown>,
): Promise<void> {
  batcher.reset();
  await attach();
}
