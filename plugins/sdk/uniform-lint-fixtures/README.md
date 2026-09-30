# Uniform declaration lint fixtures (#171 option (b))

Read as text by `web/src/plugins/pack-lint-uniforms.test.ts`; never imported or bundled.

- `bad/*.ts` — each violates one rule of `plugins/sdk/pack-lint-uniforms.ts` (the #171 shape trips two).
- `good/*.ts` — must lint clean (declarations via interpolated / imported GLSL consts, locals named
  `u…`, comments, a runtime fragment the lint can't see).
- `packs/<name>/` — virtual packs linted as `plugins/src/<name>/`: `sky/*.glsl` against the host
  plugin-sky preamble, `frontend/*.ts` `writeUniform("…")` calls against the sky.
