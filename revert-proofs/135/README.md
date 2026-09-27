# Revert proofs for PR #135

Proven product commit: `9d7378c169243f0109205de0a426fc56c6a73a73` (`RECORD.json` QE tree).

Each row is a **one-line** production revert (`.patch` passes `git apply --check` with no fuzz). Replay: `node scripts/revert-proof.mjs 135` (CI uses the vitest overlay). Sidecar `.json` files hold the byte-exact `red` line from the overlay reporter.
