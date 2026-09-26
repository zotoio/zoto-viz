# Revert proof rows

Every regression test in a PR should prove it actually catches a production bug. This folder holds **revert patches** and a generated report you paste into the PR body.

## Add a row

1. Implement the regression test and commit it (and the production fix) on your branch.
2. Under `revert-proofs/<pr-number>/`, add two files per row:
   - `<row-slug>.patch` — unified diff (`git diff` / `git apply` format) that reverts **production code only** on the PR head. Must not touch `tests/`, `*.test.ts`, `*.spec.ts`, or `test_*.py`.
   - `<row-slug>.json` — sidecar metadata:

```json
{
  "runner": "vitest",
  "testFile": "scripts/widget.test.ts",
  "testName": "returns one",
  "description": "One-line summary of what the patch reverts",
  "timeoutSec": 120,
  "allowTypeError": false,
  "allowTypeErrorReason": "optional note when allowTypeError is true"
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `runner` | yes | `vitest` or `pytest` |
| `testFile` | yes | Path to the test file (repo-relative) |
| `testName` | yes | Vitest `-t` / pytest `-k` filter (must match **exactly one** test) |
| `description` | yes | One-line revert summary for the PR table |
| `timeoutSec` | no | Per-row test timeout (default 120); timeouts are never counted as red |
| `allowTypeError` | no | When true, a patched `tsc --noEmit -p web` failure is allowed (reason shown in report) |
| `pythonModule` | no | For pytest: module to realpath-check (default `service`) |

3. Generate the table (runs each row in a **detached git worktree** at HEAD; your checkout is not mutated except for `REPORT.md`):

```bash
node scripts/revert-proof.mjs <pr-number>
```

Optional: `node scripts/revert-proof.mjs <pr-number> --row <slug>`.

Uncommitted changes in your checkout are **not** included in proofs (you get a warning). Each row must pass exactly one test on the unpatched tree, then fail that same test on an assertion after the production revert. Transform/import/collection failures and `tsc` breaks (unless `allowTypeError`) are rejected as “proves nothing”.

4. Paste `revert-proofs/<pr-number>/REPORT.md` into the PR body.

## Isolation

Rows run in a **detached git worktree** at HEAD, not in your checkout. Two traps break proofs if dependencies are shared with the original tree:

### JavaScript (pnpm workspace)

Workspace packages are linked under `node_modules`. Symlinking the whole `node_modules` tree from your checkout makes those links point at **your** `plugins/`, `web/`, etc. Node and Vite resolve the real path, so a patch in the worktree can still load **unpatched** code.

The runner runs `pnpm install --offline --frozen-lockfile` in the worktree (once per run, per `pnpm-lock.yaml` root). That reuses the global pnpm store (no network). If offline install fails, the run aborts — there is no fallback to linking. After install, every **workspace symlink** under `node_modules` (including `web/node_modules`) must `realpath` inside the worktree.

### Python (editable installs)

A venv created with `pip install -e .` records a `.pth` pointing at the **original** checkout’s `service/`. Pytest rows use the main checkout’s venv interpreter, with `PYTHONPATH=<worktree>` prepended and `cwd=<worktree>`. Before the first pytest row, the runner checks `import service` (or `pythonModule` from the sidecar) resolves inside the worktree; otherwise it aborts.

## Self-test

Not part of `pnpm test` or CI:

```bash
pnpm revert-proof:selftest
```

## Pytest rows

Use `"runner": "pytest"` with `testFile` / `testName` (`-k`). Outcomes are read from JUnit XML (`failed` vs `error`).
