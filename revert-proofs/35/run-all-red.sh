#!/usr/bin/env bash
# Run every revert proof; prints red pytest/vitest output (each patch must fail its test).
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
for json in "$DIR"/*.json; do
  row="$(basename "$json" .json)"
  echo "======== $row ========"
  "$DIR/verify-row.sh" "$row" || true
  echo
done
