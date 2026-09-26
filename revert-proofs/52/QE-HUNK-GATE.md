# QE hunk-to-row gate (PR #52a / #52b)

1. Paste `pr-52a-hunk-to-row.md` and `pr-52b-hunk-to-row.md` into each stacked PR body.
2. Re-run sweep at PR HEAD (must exit **0**):

```bash
python3 revert-proofs/52/run-hunk-sweep.py
```

3. Regenerate tables after sweep:

```bash
python3 revert-proofs/52/generate-hunk-tables.py
```

Split assignment: `split-manifest.yml`. Any production hunk under `web/src` (excluding `*.test.ts`) with sweep **GREEN** is a **Fail**.
