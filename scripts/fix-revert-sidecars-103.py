#!/usr/bin/env python3
"""Fix revert-proofs/103/*.json testName fields from vitest list."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROOFS = ROOT / "revert-proofs" / "103"

FIXES = {
    "consent-pending-on-deny": "mosaic consent resume > registers a pending tile pick when consent is denied",
    "consent-post-catalog-resume": "grantPluginConsent then catalog refresh > simulates POST /consent updating catalog before resume",
    "consent-resume-all-tiles": "grantPluginConsent then catalog refresh > resumes every waiting tile for the same pack after one approval",
    "consent-resume-external-approve": "mosaic consent resume > retries through switchPaneView when consent appears (external approve)",
    "consent-sync-one-poll": "plugin consent sync (one page subscription) > arms one shared fallback poll for many waiting tiles",
    "consent-sync-one-refresh": "plugin consent sync (one page subscription) > after 10s idle issues one catalog refresh, not one per tile",
    "consent-sync-stop-poll": "plugin consent sync (one page subscription) > stops the shared poll when no tiles are waiting",
    "reload-header-mode-persisted": "mosaic view reload regressions (B/C/D/E) > B: 1× reload keeps header and main mode aligned via persisted zoto-viz.mode",
    "reload-header-swaps-focused-tile": "mosaic view reload regressions (B/C/D/E) > C: header pick swaps the focused tile (not header-only)",
    "reload-neighbour-teardown-only-from": "mosaic view reload regressions (B/C/D/E) > D: neighbour pane pick does not teardown the focused tile view",
    "reload-reconcile-backrooms-slot": "mosaic view reload regressions (B/C/D/E) > E: reload restores Backrooms on the focused slot when mode and tiles diverged",
    "settings-mosaic-pick-delegates-hook": "mosaic view reload regressions (B/C/D/E) > pane picker delegates through the live hook and persists layout",
    "switch-pane-header-deny": "switchPaneView > entry header > denies consent without swapping or mounting",
    "switch-pane-header-succeeds": "switchPaneView > entry header > succeeds through teardown, swap, and mount",
    "switch-pane-header-swap-from-focus": "switchPaneView > entry header > uses focus fallback when the requested tile id is stale",
    "switch-pane-tile-stale-from": "switchPaneView > entry tile > uses focus fallback when the requested tile id is stale",
    "switch-pane-tile-succeeds": "switchPaneView > entry tile > succeeds through teardown, swap, and mount",
    "panel-view-swap-no-csp-violation": "mosaic panel view switch teardown > emits no securitypolicyviolation during 20 back-and-forth pane view swaps",
}

def main() -> None:
    for path in sorted(PROOFS.glob("*.json")):
        base = path.stem
        if base not in FIXES:
            continue
        data = json.loads(path.read_text())
        data["testName"] = FIXES[base]
        path.write_text(json.dumps(data, indent=2) + "\n")
        print(f"updated {base}")

if __name__ == "__main__":
    main()
