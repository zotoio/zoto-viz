# Revert proofs for PR #135

Proven product commit: `9d7378c169243f0109205de0a426fc56c6a73a73` (`RECORD.json` QE tree).

Rows replay with `node scripts/revert-proof.mjs 135` (or apply each `.patch` and run the vitest named in the sidecar). Red assertion lines are in `red/*.txt` and sidecar `red` fields.
