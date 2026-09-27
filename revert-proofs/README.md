# Revert proof rows

**Room decision:** Revert-proof rows are **data only** (patches + sidecars under this directory). They are **not** a required CI check. Re-run `node scripts/revert-proof.mjs <pr>` after merge **only when someone asks** for fresh evidence; do not treat `REPORT.md` as a merge gate.

Every regression test in a PR should prove it actually catches a production bug. This folder holds **revert patches** and an optional generated `REPORT.md` table for human review.

## Add a row

1. Implement the regression test and commit it (and the production fix) on your branch.
2. Under `revert-proofs/<pr-number>/`, add two files per row:
   - `<row-slug>.patch` — unified diff (`git diff` / `git apply` format) that reverts **production code only** on the PR head. Must not touch `tests/`, `*.test.ts`, `*.spec.ts`, or `test_*.py`.
   - `<row-slug>.json` — sidecar metadata:

```json
{
  "runner": "vitest",
  "testFile": "scripts/widget.test.ts",
  "testName": "widget > returns one",
  "description": "One-line summary of what the patch reverts",
  "red": { "actual": 2, "expected": 1 },
  "timeoutSec": 120,
  "allowTypeError": false,
  "allowTypeErrorReason": "optional note when allowTypeError is true"
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `runner` | yes | `vitest` or `pytest` |
| `testFile` | yes | Path to the test file (repo-relative) |
| `testName` | yes | Vitest **fullTestName** exactly as reported (including literal ` > ` inside describe titles); runner passes `-t "^…$"` with only regex metacharacters escaped, then matches the JSON reporter row whose rebuilt name (`ancestorTitles` joined with ` > ` plus `title`) equals the sidecar. That test must be **passed** unpatched and **failed** patched; every other test in the JSON output must be **skipped**. Rows whose target test is skipped (`it.skipIf`, `ctx.skip()`) are rejected. Pytest: node id `testFile::testName` (never `-k`); plugin JSON must show the same node id with the same pass/fail/skip rules |
| `description` | yes | One-line revert summary for the PR table |
| `red` | yes | **Vitest:** `{ "actual": …, "expected": … }` from the first branded `expect` / `expect.soft` failure (`task.meta.revertProofRed`), JSON-normalized when branded (`undefined` becomes `null`). **Pytest:** `{ "assert": "assert …" }` — source line of the rewritten `assert` in the test file's last traceback frame. Compared with deep equality (JSON); not a regex over the message. If multiple assertions fail, only the **first** counts; a row whose first failure does not match `red` is rejected. |
| `timeoutSec` | no | Per-row test timeout (default 120); timeouts are never counted as red |
| `allowTypeError` | no | When true, a patched `tsc --noEmit -p web` failure is allowed (reason shown in report) |
| `pythonModule` | no | For pytest: module to realpath-check (default `service`) |

3. Optionally generate the table (runs each row in a **detached git worktree** at HEAD; your checkout is not mutated except for `REPORT.md`):

```bash
node scripts/revert-proof.mjs <pr-number>
```

Optional: `node scripts/revert-proof.mjs <pr-number> --row <slug>`.

4. If you re-run proofs, attach or link `revert-proofs/<pr-number>/REPORT.md` in the PR thread when requested — not as an automatic merge requirement.

Uncommitted changes in your checkout are **not** included in proofs (you get a warning). Each row must pass exactly one test on the unpatched tree, then fail that same test with a branded assertion after the production revert, and the structured `red` must match the first failure. Transform/import/collection failures and `tsc` breaks (unless `allowTypeError`) are rejected as “proves nothing”.

### Vitest (room decision)

The overlay **setup file** wraps chai `Assertion.prototype` methods. Errors thrown there are stored in a module-private `WeakSet` in `scripts/revert-proof-vitest-brand.mjs`; the overlay externalizes that module so the setup file and the natively loaded runner share one instance. `{ actual, expected }` is captured at brand time (Vitest later stringifies both on recorded errors). `expect.soft()` failures never leave the matcher, so the brand module keeps the first branded soft failure per test for the runner. The custom runner accepts only branded errors, records `{ actual, expected }` from the **first** branded failure (a soft failure before a throw wins), and writes `revertProofAssertion` / `revertProofRed` into a **frozen** `task.meta` in `onAfterRunTask` after all hooks. Only **`expect()` and `expect.soft()`** matchers count (same chai path). `node:assert` is **not** accepted.

### Pytest (room decision)

The plugin accepts only failures whose **last traceback frame in the test file** is a rewritten `assert …` statement. Hand-written `raise AssertionError()` (including from production code) is rejected.

### What the runner does **not** defend against

The runner guards against **accidents** in normal `expect` / `assert` usage, not a dishonest test author. There is **no** code and **no** revert row for:

- A `TypeError` with a swapped `AssertionError` prototype
- A hand-built `chai.AssertionError` or `new AssertionError()` without going through `expect` / `assert`
- Subclasses of `AssertionError` thrown without the branding path
- A test that deliberately calls real `expect(1).toBe(0)` to force red

Patches must touch **production-reachable** code (see `scripts/revert-proof-production.json`). Runner-owned files in `reachExempt` may be targeted by self-test rows.

## Isolation

Rows run in a **detached git worktree** at HEAD, not in your checkout. Two traps break proofs if dependencies are shared with the original tree:

### JavaScript (pnpm workspace)

Workspace packages are linked under `node_modules`. Symlinking the whole `node_modules` tree from your checkout makes those links point at **your** `plugins/`, `web/`, etc. Node and Vite resolve the real path, so a patch in the worktree can still load **unpatched** code.

The runner runs `pnpm install --offline --frozen-lockfile` in the worktree (once per run, per `pnpm-lock.yaml` root). That reuses the global pnpm store (no network). If offline install fails, the run aborts — **there is no fallback to linking** the checkout’s `node_modules`. After install, every **workspace symlink** under `node_modules` (including `web/node_modules`) must `realpath` inside the worktree (links into the main checkout are rejected).

### Python (editable installs)

A venv created with `pip install -e .` records a `.pth` pointing at the **original** checkout’s `service/`. Pytest rows use the main checkout’s venv interpreter, with `PYTHONPATH=<worktree>` only and `cwd=<worktree>`. Before the first pytest row, the runner checks `import service` (or `pythonModule` from the sidecar) resolves inside the worktree; otherwise it aborts.

## Self-test

Not part of `pnpm test` or CI:

```bash
pnpm revert-proof:selftest
```

## Pytest rows

Use `"runner": "pytest"` with `testFile` / `testName` (pytest node id `file::test`, never `-k`). Red requires `revertProofAssertion: true` and matching structured `red.assert` from the plugin JSON.

Optional `project` on vitest rows: `"web"` or `"scripts"` (default inferred from `testFile` prefix).
