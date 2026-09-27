## Revert proof

| row | test | revert description | command | result |
| --- | --- | --- | --- | --- |
| plugin-sandbox-sdk-types | web: pnpm typecheck | plugins/sdk/plugin-sandbox.ts stays referenced for pack #24 type imports | pnpm typecheck (cwd web) | RED (expected) |

### plugin-sandbox-sdk-types

```
> tsc --noEmit -p tsconfig.typecheck.json

typecheck/plugin-sandbox.typecheck.ts(1,15): error TS2305: Module '"../../plugins/sdk/plugin-sandbox"' has no exported member 'ZotoVizPluginHost'.
 ELIFECYCLE  Command failed with exit code 1.
```
