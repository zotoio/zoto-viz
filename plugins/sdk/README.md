# Viz plugin SDK (`plugins/sdk`)

Shared types and helpers for pack authors and CI guardrails.

## Sandbox `zoto` object

Packs run in a CSP sandbox iframe. After the host boots the SDK, `globalThis.zoto` implements **`VizZoto`** (`viz-zoto.ts`): config callbacks, frame/tick/present handlers, buffer/uniform writes, and optional `getConfig()`.

```ts
import type { VizZoto } from "./viz-zoto";

const zoto = globalThis.zoto as VizZoto;
```

Do **not** use `declare const zoto` in pack source — pack lint baselines `inline-zoto-declare` and points here.

Host contract additions land on the same interface (for example `setConfig` in #36, `onPresent` in #37), not in new parallel type modules.

## Pack lint

See `pack-lint.ts`, `pack-lint-host.ts`, and `pack-lint-baseline.json`. Host reverse boundary violations are keyed by **resolved repo-relative pack paths** (symlinks and import specifiers normalize to the same target).
