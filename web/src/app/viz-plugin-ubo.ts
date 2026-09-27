/** Push the host viz UBO to the header scene and every mosaic graph scene. */
export function broadcastPluginUbo(
  mainScene: { setPluginUboBuffer(buf: Float32Array): void },
  buf: Float32Array,
  mosaic: {
    tileIds: readonly string[];
    graphScene: (id: string) => { setPluginUboBuffer(buf: Float32Array): void } | null;
  } | null | undefined,
): void {
  mainScene.setPluginUboBuffer(buf);
  if (!mosaic) return;
  for (const id of mosaic.tileIds) {
    mosaic.graphScene(id)?.setPluginUboBuffer(buf);
  }
}
