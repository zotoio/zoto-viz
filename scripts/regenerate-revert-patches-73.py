#!/usr/bin/env python3
"""Regenerate revert-proofs/73/*.patch from HEAD (zero git apply offset)."""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROOFS = ROOT / "revert-proofs/73"

REMOVED = {
    "mosaic-tile-id-parse",
    "scope-note-steady-recount",
    "scope-note-drawer-layout-rebind",
    "scope-note-mosaic-layout-focus-layout",
    "scope-note-slider-rebuild-mid-drag",
    "scope-note-apply-mode-guard",
    "scope-note-two-tiles",
    "apply-instance-pack-name",
    "plugin-fields-shared-mosaic",
    "plugin-fields-view-focus",
}


def read(rel: str) -> str:
    return (ROOT / rel).read_text()


def write(rel: str, text: str) -> None:
    (ROOT / rel).write_text(text)


def checkout_web() -> None:
    subprocess.run(["git", "checkout", "HEAD", "--", "web"], cwd=ROOT, check=True)


def git_diff(paths: list[str]) -> str:
    r = subprocess.run(
        ["git", "diff", "--no-color", "--"] + paths,
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=True,
    )
    if not r.stdout.strip():
        raise SystemExit(f"empty diff for {paths}")
    return r.stdout


def apply_edit(rel: str, head: str, reverted: str, *, replace_all: bool = False) -> None:
    text = read(rel)
    if head not in text:
        raise SystemExit(f"{rel}: missing HEAD anchor ({len(head)} bytes)")
    write(rel, text.replace(head, reverted, -1 if replace_all else 1))


def parse_patch_edits(patch_text: str) -> list[tuple[str, str, str]]:
    edits: list[tuple[str, str, str]] = []
    file_rel: str | None = None
    minus: list[str] = []
    plus: list[str] = []

    def flush() -> None:
        nonlocal minus, plus
        if file_rel and minus:
            edits.append((file_rel, "\n".join(minus), "\n".join(plus)))
        minus, plus = [], []

    for line in patch_text.splitlines():
        if line.startswith("diff --git "):
            flush()
            m = re.search(r" b/(web/.+)$", line)
            file_rel = m.group(1) if m else None
            continue
        if line.startswith("--- a/"):
            flush()
            file_rel = line[6:].split("\t", 1)[0]
            continue
        if line.startswith("@@"):
            flush()
            continue
        if line.startswith("-") and not line.startswith("---"):
            minus.append(line[1:])
        elif line.startswith("+") and not line.startswith("+++"):
            plus.append(line[1:])
    flush()
    return edits


def write_row_from_edits(name: str, edits: list[tuple[str, str, str]], *, replace_all: bool = False) -> None:
    paths = sorted({rel for rel, _, _ in edits})
    checkout_web()
    for rel, head, rev in edits:
        apply_edit(rel, head, rev, replace_all=replace_all)
    (PROOFS / f"{name}.patch").write_text(git_diff(paths))
    checkout_web()


def normalize_legacy_patch(name: str) -> None:
    patch_path = PROOFS / f"{name}.patch"
    checkout_web()
    check = subprocess.run(
        ["git", "apply", "--check", str(patch_path)],
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    if check.returncode != 0:
        edits = parse_patch_edits(patch_path.read_text())
        if not edits:
            raise SystemExit(f"{name}: cannot apply or parse patch")
        inverted = [(rel, rev, head) for rel, head, rev in edits]
        write_row_from_edits(name, inverted)
        return
    subprocess.run(["git", "apply", str(patch_path)], cwd=ROOT, check=True)
    diff = git_diff(["web"])
    patch_path.write_text(diff)
    checkout_web()


def run_vitest_red(test_file: str, test_name: str) -> str:
    r = subprocess.run(
        ["pnpm", "exec", "vitest", "run", test_file, "-t", test_name],
        cwd=ROOT / "web",
        capture_output=True,
        text=True,
    )
    blob = r.stdout + "\n" + r.stderr
    for line in blob.splitlines():
        if line.strip().startswith("AssertionError:"):
            return line.strip()
    if "error TS" in blob:
        for line in blob.splitlines():
            if "error TS" in line:
                return line.strip()
    raise SystemExit(f"no red line for {test_file} {test_name}\n{blob[-2000:]}")


def write_json(name: str, data: dict) -> None:
    (PROOFS / f"{name}.json").write_text(json.dumps(data, indent=2) + "\n")


def custom_edits(name: str) -> list[tuple[str, str, str]] | None:
    if name == "main-on-plugin-fields-wiring":
        head = read("web/src/app/main-on-plugin-fields.ts")
        old = """export function runMainOnPluginFields(deps: MainOnPluginFieldsDeps): void {
  syncPluginFieldsFromSettingsEdit({
    settings: deps.settings,
    fallbackModeId: deps.modeSelValue,
    hostModeById: deps.hostModeById,
    optsFor: deps.optsFor,
    mosaic: deps.mosaic,
    scene: deps.scene,
    pluginSpecForMode: deps.pluginSpecForMode,
    setCurrentOpts: deps.setCurrentOpts,
    setSkyPrompt: deps.setSkyPrompt,
    setNestLook: deps.setNestLook,
    isCarouselMode: deps.isCarouselMode,
    onCarouselBind: deps.onCarouselBind,
    viewPromptKey: deps.viewPromptKey,
    afterSync: deps.afterSync,
  });
}"""
        new = """export function runMainOnPluginFields(deps: MainOnPluginFieldsDeps): void {
  const m = deps.hostModeById(deps.modeSelValue());
  const opts = deps.optsFor(m);
  deps.setCurrentOpts(opts);
  deps.setSkyPrompt(m.pluginId ?? m.id, opts[deps.viewPromptKey] ?? "");
  deps.setNestLook(opts);
  if (deps.isCarouselMode(m)) deps.onCarouselBind(opts);
  if (deps.mosaic?.on && !(m.pluginId && m.standalone)) {
    deps.mosaic.graphScene(m.id)?.setMode(m, opts);
  } else {
    deps.scene.setMode(m, opts);
  }
  deps.afterSync(m, opts);
}"""
        return [("web/src/app/main-on-plugin-fields.ts", old, new)]
    if name == "main-bind-this-view-wiring":
        old = read("web/src/app/main-bind-this-view.ts")
        new = old.replace(
            """import type { ViewMode } from "../core/modes";
import type { PluginLook, PluginView } from "../plugins/plugin";
import type { Settings } from "../ui/settings";
import { bindThisView as bindThisViewHost, type BindThisViewDeps } from "./host-view-bind";""",
            """import { modeById, type ViewMode } from "../core/modes";
import type { PluginLook, PluginView } from "../plugins/plugin";
import type { Settings } from "../ui/settings";""",
        ).replace(
            """export function runMainBindThisView(deps: MainBindThisViewDeps, modeId: string): void {
  if (!deps.settings) return;
  const hostDeps: BindThisViewDeps = {
    settings: deps.settings,
    hostModeById: deps.hostModeById,
    pluginSpecForMode: deps.pluginSpecForMode,
    lookForMode: deps.lookForMode,
    arcadeControls: deps.arcadeControls,
    paintViewAuth: deps.paintViewAuth,
  };
  bindThisViewHost(hostDeps, modeId);
}""",
            """export function runMainBindThisView(deps: MainBindThisViewDeps, modeId: string): void {
  if (!deps.settings) return;
  const m = modeById(modeId);
  const spec = m.pluginId ? deps.pluginSpecForMode(m.id) : null;
  deps.settings.bindView(
    spec ? { ...spec, options: m.options, config: m.config } : null,
    spec ? m.config : undefined,
    deps.lookForMode(m.id) ?? spec?.look,
    deps.arcadeControls(m),
    modeId,
  );
  deps.paintViewAuth(m, spec);
}""",
        )
        return [("web/src/app/main-bind-this-view.ts", old, new)]
    if name == "main-apply-mode-drawer-wiring":
        return [
            (
                "web/src/app/main-apply-mode-drawer.ts",
                "  rebindViewDrawerOnApplyMode(bindThisView, rebindCtx);",
                "  bindThisView(ctx.modeId);",
            ),
        ]
    if name == "settings-mosaic-pane-sync-tiles":
        head = """        if (this.onMosaicPanePick) {
          if (!this.onMosaicPanePick(from, to)) fillViewSelect(sel, from);
        } else {
          const next = nextPaneTiles(ids, from, to);
          this.anim.mosaicTiles = parseMosaicTiles(next);
          if (this.anim.mosaicTree) this.anim.mosaicTree = assignTiles(this.anim.mosaicTree, this.anim.mosaicTiles);
          this.persistAnim();
          this.animUi?.syncTiles();
        }"""
        rev = """        if (this.onMosaicPanePick) {
          if (!this.onMosaicPanePick(from, to)) fillViewSelect(sel, from);
        } else {
          const next = nextPaneTiles(ids, from, to);
          this.anim.mosaicTiles = parseMosaicTiles(next);
          if (this.anim.mosaicTree) this.anim.mosaicTree = assignTiles(this.anim.mosaicTree, this.anim.mosaicTiles);
          this.persistAnim();
        }
        this.animUi?.syncTiles();"""
        return [("web/src/ui/settings.ts", head, rev)]
    if name == "compile-instance-label":
        rel = "web/src/plugins/plugin.ts"
        head = "    label: tileDisplayName(spec),"
        rev = "    label: spec.packName,"
        text = read(rel)
        if text.count(head) < 2:
            raise SystemExit(f"{rel}: expected 2 tileDisplayName labels")
        return [(rel, head, rev)]  # first only; write_row applies once — handle below
    return None


NEW_META: dict[str, dict] = {
    "main-on-plugin-fields-wiring": {
        "testFile": "src/app/main-on-plugin-fields.wiring.test.ts",
        "testName": "^main onPluginFields wiring > mosaic shared config sync > calls setMode on every duplicate tile when plugin fields change$",
        "description": "main onPluginFields must sync shared mosaic plugin config.",
    },
    "main-bind-this-view-wiring": {
        "testFile": "src/app/main-bind-this-view.wiring.test.ts",
        "testName": "^main bindThisView wiring > mosaic slot mode id > bindView receives the slot mode id for duplicate tiles$",
        "description": "main bindThisView must use hostModeById for slot mode ids.",
    },
    "main-apply-mode-drawer-wiring": {
        "testFile": "src/app/main-apply-mode-drawer.wiring.test.ts",
        "testName": "^main applyMode drawer wiring > rebind guard > does not rebuild the drawer when applyMode keeps the same drawer key$",
        "description": "main applyMode must not rebuild the drawer when the drawer key is unchanged.",
    },
    "settings-mosaic-pane-sync-tiles": {
        "testFile": "src/ui/settings-mosaic-pane-sync-tiles.wiring.test.ts",
        "testName": "^settings mosaic pane pick wiring > syncTiles after slot change > calls syncTiles once per live mosaic pane pick through onMosaicPanePick$",
        "description": "Mosaic slot picker must call syncTiles after onMosaicPanePick.",
    },
    "compile-instance-label": {
        "testFile": "src/plugins/plugin.test.ts",
        "testName": "^compilePlugin > instance label on compiled modes > uses the instance label Alt feed for graph and arcade compiles$",
        "description": "compilePlugin uses tileDisplayName (instance label), not packName alone.",
    },
}


def main() -> None:
    for stem in REMOVED:
        for ext in (".patch", ".json"):
            p = PROOFS / f"{stem}{ext}"
            if p.is_file():
                p.unlink()

    for name in NEW_META:
        edits = custom_edits(name)
        assert edits
        write_row_from_edits(name, edits, replace_all=(name == "compile-instance-label"))

    for name in sorted(NEW_META):
        meta = NEW_META[name]
        checkout_web()
        subprocess.run(["git", "apply", "--check", str(PROOFS / f"{name}.patch")], cwd=ROOT, check=True)
        subprocess.run(["git", "apply", str(PROOFS / f"{name}.patch")], cwd=ROOT, check=True)
        red = run_vitest_red(meta["testFile"], meta["testName"])
        checkout_web()
        write_json(
            name,
            {
                "runner": "vitest",
                "testFile": meta["testFile"],
                "testName": meta["testName"],
                "description": meta["description"],
                "redOutput": red,
            },
        )

    legacy = sorted(
        p.stem for p in PROOFS.glob("*.patch") if p.stem not in NEW_META
    )
    for name in legacy:
        normalize_legacy_patch(name)
        out = subprocess.run(
            ["git", "apply", "--check", "-v", str(PROOFS / f"{name}.patch")],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        if "offset" in out.stdout or "fuzz" in out.stdout:
            raise SystemExit(f"{name} still has offset/fuzz:\n{out.stdout}")

    print(f"rows: {len(NEW_META)} new + {len(legacy)} legacy = {len(NEW_META) + len(legacy)}")


if __name__ == "__main__":
    main()
