# Pack SDK (viz fixtures)

Shared **VizDataFrame** contract and frozen fixtures for pack light tests live here.
Import types from `plugins/sdk/viz-contract.ts` and fixtures from
`plugins/sdk/viz-fixtures.ts`.

## Frozen fixtures

Regenerate JSON after host frame changes:

```bash
cd web
FREEZE_VIZ_FIXTURES=1 pnpm exec vitest run src/plugins/fixtures/viz-sdk-fixtures.freeze.test.ts
```

Refresh the quiet VM capture state (`fixtures/vm-live-state.json`) with the
`viz-vm-live-capture` test (`CAPTURE_VM_LIVE=1` or `IMPORT_VM_LIVE_RAW=…`).

Run pack smoke tests against shared frames:

```ts
import { runPackOnFixtures } from "../../plugins/sdk/viz-fixtures";

runPackOnFixtures((frame) => {
  myPackOnFrame(frame);
});
```

Default set: `idle`, `golden-live`, `vm-live`.

## Dev monitor: `?vizFixture=`

On the **Vite dev server only** (`import.meta.env.DEV`), open the monitor with
`?vizFixture=<name>` to feed a shared fixture every tick instead of live or idle
merge traffic. Production builds compile this switch out entirely.

| Value | Frame source |
| --- | --- |
| `idle` | Host idle merge on empty monitor (`buildVizSdkIdleFrame`) |
| `idle-failed` | Demo idle with `talkers[].failed` and elevated `sys.failed` |
| `golden-live` | Golden seed LAN capture |
| `vm-live` | Quiet VM LAN + host idle merge |

Examples: `http://127.0.0.1:7020/?vizFixture=idle-failed`,
`http://127.0.0.1:5173/?vizFixture=golden-live`.

Unknown names log a console warning and are ignored.
