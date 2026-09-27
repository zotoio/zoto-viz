function envVar(name: string): string | undefined {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.[name];
}

/** Substring expected in WEBGL_debug_renderer_info when `ZOTO_VIZ_EXPECT_RENDERER` is set (e.g. CI). */
export function expectedRendererNeedle(): string | undefined {
  const raw = envVar("ZOTO_VIZ_EXPECT_RENDERER")?.trim();
  return raw || undefined;
}

export function assertPackMirrorRenderer(renderer: string): void {
  if (!renderer) {
    throw new Error("WebGL renderer string is empty");
  }
  const needle = expectedRendererNeedle();
  if (needle && !renderer.toLowerCase().includes(needle.toLowerCase())) {
    throw new Error(`renderer "${renderer}" does not contain "${needle}"`);
  }
}
