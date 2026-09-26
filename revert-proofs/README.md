# Revert proof rows

Every regression test in a PR should prove it actually catches a production bug. This folder holds **revert patches** and a generated report you paste into the PR body.

## Add a row

1. Create a branch and implement the regression test on a **clean** worktree.
2. Under `revert-proofs/<pr-number>/`, add two files per row:
   - `<row-slug>.patch` — unified diff (`git diff` / `git apply` format) that reverts **production code only** on the PR head. Must not touch `tests/`, `*.test.ts`, `*.spec.ts`, or `test_*.py`.
   - `<row-slug>.json` — metadata:

```json
{
  "runner": "vitest",
  "test": "scripts/widget.test.ts -t \"returns one\"",
  "description": "One-line summary of what the patch reverts"
}
```

`runner` is `vitest` or `pytest`. The `test` field is the file path plus filter (`vitest -t` or `pytest -k` / nodeid).

3. Generate the table:

```bash
node scripts/revert-proof.mjs <pr-number>
```

Optional: `node scripts/revert-proof.mjs <pr-number> --row <slug>` for a single row.

4. Paste `revert-proofs/<pr-number>/REPORT.md` into the PR body (or include its table and fenced failure blocks).

The script checks out nothing: it requires a clean git worktree, runs each test green, applies the patch, runs the test red, then `git apply -R` in a `finally` block (including on SIGINT).

## Self-test

This tool is **not** part of `pnpm test` or CI (it mutates the worktree). Run:

```bash
pnpm revert-proof:selftest
```

## Pytest rows

Use the same layout with `"runner": "pytest"` and `"test": "tests/test_foo.py -k pattern"` when the regression test lives in pytest.
