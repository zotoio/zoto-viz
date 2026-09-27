# Viz plugin SDK (`plugins/sdk`)

Shared types and helpers for pack authors and CI guardrails.

## Sandbox host API (`getVizZoto`)

Packs run in a CSP sandbox iframe. After the host boots the SDK, `globalThis.zoto` implements **`VizZoto`** (`viz-zoto.ts`). Packs must **not** bind a top-level identifier named `zoto` (the host no longer injects one). Use the bundled helper:

```ts
import { getVizZoto } from "./viz-zoto";

const host = getVizZoto();
host.onFrame = (frame) => { /* … */ };
```

Do **not** use `declare const zoto`, `const zoto = globalThis.zoto as VizZoto`, or other top-level `zoto` bindings — pack lint flags `inline-zoto-declare` and `pack-zoto-binding`.

Host contract additions land on the same `VizZoto` interface (for example `setConfig` in #36, `onPresent` in #37), not in new parallel type modules.

## Held packs migration (PR #35 checklist)

In-flight pack PRs **#17, #19, #21, #22, #24, #29, #30, #31** should switch to `getVizZoto()` before merge:

1. `import { getVizZoto } from "../../../sdk/viz-zoto"` (adjust `../` depth to your entry).
2. `const host = getVizZoto();` then use `host` instead of `zoto`.
3. Remove `declare const zoto` and any `globalThis.zoto` cast lines.
4. Re-run `cd web && pnpm pack-lint ../plugins/src/<id>`.

## Placement: `plugins/sdk` vs host

Pure helpers with **no host message formatting** may live in `plugins/sdk` and are **bundled into pack `module.js`** (for example `talker-slots.ts`, `viz-zoto.ts` / `getVizZoto()`). They must not call `postMessage` or import host message/transport types (`web/src/plugins/host`, `HostMsg`, `ParentMsg`, etc.). `getVizZoto()` only returns `globalThis.zoto` with the `VizZoto` type. Pack lint rule **`host-transport-escape`** enforces this in pack trees and `plugins/sdk` sources.

## SDK contract stability

After PR #35, exports under `plugins/sdk` are treated like the viz frame contract: **additive-only** within a `PACK_SDK_CONTRACT_VERSION` generation. Breaking export or helper signature changes require bumping `PACK_SDK_CONTRACT_VERSION` in `pack-sdk-contract.ts`.

Successful pack bundles write `pack-build.manifest.json` at the pack root with `{ "sdkContractVersion": <n> }`. When the running host’s contract is newer than the stamped version, catalog scan surfaces a labelled blocked tile (not a raw build error): *Built for an older zoto-viz SDK — needs an update from its author. Nothing else changed.*

## Pack lint

See `pack-lint.ts`, `pack-lint-host.ts`, and `pack-lint-baseline.json`. Host reverse boundary violations are keyed by **resolved repo-relative pack paths** (symlinks and import specifiers normalize to the same target).
