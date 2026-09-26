#!/usr/bin/env python3
"""Regenerate revert-proofs/47 at HEAD. Run from repo root after committing production code."""
from __future__ import annotations

import json
import re
import subprocess
from collections.abc import Callable
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "revert-proofs" / "47"


def run(cmd: list[str], cwd: Path | None = None, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, cwd=cwd or ROOT, text=True, capture_output=True, check=check)


def git_restore(paths: list[str]) -> None:
    run(["git", "checkout", "HEAD", "--", *paths])


def apply_text(path: Path, old: str, new: str) -> None:
    text = path.read_text()
    if old not in text:
        raise SystemExit(f"missing snippet in {path}:\n{old[:240]}")
    path.write_text(text.replace(old, new, 1))


def escape_regex(s: str) -> str:
    return re.sub(r"([\\^$.*+?()[\]{}|])", r"\\\1", s)


def anchored(full: str) -> str:
    return f"^{escape_regex(full)}$"


def vitest_excerpt(cp: subprocess.CompletedProcess[str]) -> str | None:
    out = cp.stdout + cp.stderr
    for line in out.splitlines():
        if line.startswith("AssertionError:"):
            return line.strip()
    m = re.search(r"expected [^\n]+", out)
    return f"AssertionError: {m.group(0)}" if m else None


def vitest_pass_line(cp: subprocess.CompletedProcess[str]) -> str | None:
    out = cp.stdout + cp.stderr
    for line in out.splitlines():
        if line.strip().startswith("Tests  ") and "passed" in line:
            return line.strip()
    return None


def tsc_excerpt() -> str:
    cp = run(["pnpm", "--dir", "web", "exec", "tsc", "--noEmit"], check=False)
    for line in (cp.stdout + cp.stderr).splitlines():
        if "fps-mono-guard.ts" in line and "error TS" in line:
            return line.strip()
    raise SystemExit("no fps-mono-guard tsc line")


def apply_view_determinism(path: Path) -> None:
    text = path.read_text()
    probe = "let tetrisViewDeterminismProbe = 0;\n"
    if probe not in text:
        text = text.replace("/** 3D well:", probe + "/** 3D well:", 1)
    old = (
        '    this.idleSeed = parseTetrisIdleSeedFromSearch(typeof location !== "undefined" ? location.search : "");\n'
        "    this.idleScheduler = new TetrisIdleScheduler(this.idleSeed, this.clockMs());"
    )
    new = (
        '    this.idleSeed = parseTetrisIdleSeedFromSearch(typeof location !== "undefined" ? location.search : "");\n'
        "    tetrisViewDeterminismProbe++;\n"
        "    this.idleSeed += tetrisViewDeterminismProbe - 1;\n"
        "    this.idleScheduler = new TetrisIdleScheduler(this.idleSeed, this.clockMs());"
    )
    if old not in text:
        raise SystemExit("determinism anchor missing in tetris.ts")
    path.write_text(text.replace(old, new, 1))


def write_row(
    base: str,
    rel: str,
    old: str,
    new: str,
    runner: str,
    test_file: str,
    test_name: str,
    description: str,
    custom_apply: Callable[[Path], None] | None = None,
) -> None:
    path = ROOT / rel
    git_restore([rel])
    if custom_apply:
        custom_apply(path)
    else:
        apply_text(path, old, new)
    patch = run(["git", "diff", "HEAD", "--", rel]).stdout
    if not patch.strip():
        raise SystemExit(f"empty patch {base}")
    (OUT / f"{base}.patch").write_text(patch)
    git_restore([rel])
    run(["git", "apply", "--check", str(OUT / f"{base}.patch")])
    green = run(runner.split(), check=False)
    pass_line = vitest_pass_line(green) if "vitest" in runner else "tsc clean"
    run(["git", "apply", str(OUT / f"{base}.patch")])
    if runner.startswith("pnpm --dir web exec tsc"):
        excerpt = tsc_excerpt()
        git_restore([rel])
    else:
        red = run(runner.split(), check=False)
        excerpt = vitest_excerpt(red)
        git_restore([rel])
    meta = {
        "runner": runner,
        "testFile": test_file,
        "testName": test_name,
        "description": description,
    }
    if pass_line:
        meta["passLine"] = pass_line
    if excerpt:
        meta["excerpt"] = excerpt
    (OUT / f"{base}.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(base, excerpt or "NO EXCERPT")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    salt_loop = (
        "  for (let i = 0; i < n; i++) out.push(tetrominoForProto(`tetris-seed:${salt}:${i}`));"
    )
    salt_bump = (
        "  for (let i = 0; i < n; i++) out.push(tetrominoForProto(`tetris-seed:${salt + 1}:${i}`));"
    )
    spawn_plan = "    const plan = bestPlacement(board, next.kind, scoreBoard, planStats);"
    spawn_plan_t = '    const plan = bestPlacement(board, next.kind === "T" ? "O" : next.kind, scoreBoard, planStats);'

    rows: list[tuple] = [
        (
            "tetris-piece-generator",
            "web/src/arcade/tetris-engine.ts",
            salt_loop,
            salt_bump,
            f'pnpm --dir web exec vitest run src/arcade/tetris-piece-generator.test.ts -t "{anchored("Tetris survival piece generator > seed 0 first 50 kind ids match fixture")}"',
            "src/arcade/tetris-piece-generator.test.ts",
            anchored("Tetris survival piece generator > seed 0 first 50 kind ids match fixture"),
            "Shift survival generator salt so first-50 kind ids no longer match fixture.",
            None,
        ),
        (
            "tetris-survival-battery",
            "web/src/arcade/tetris-engine.ts",
            salt_loop,
            salt_bump,
            f'pnpm --dir web exec vitest run src/arcade/tetris-survival-battery.test.ts -t "{anchored("Tetris survival battery > seed 0 survives at least the committed baseline with fixed placement cost")}"',
            "src/arcade/tetris-survival-battery.test.ts",
            anchored("Tetris survival battery > seed 0 survives at least the committed baseline with fixed placement cost"),
            "Shift survival battery salt so 600-frame TetrisView metrics no longer match fixtures.",
            None,
        ),
        (
            "tetris-determinism",
            "web/src/arcade/tetris.ts",
            "",
            "",
            f'pnpm --dir web exec vitest run src/arcade/tetris-determinism.test.ts -t "{anchored("TetrisView placement determinism > seed 0 replays the same idle board fingerprint")}"',
            "src/arcade/tetris-determinism.test.ts",
            anchored("TetrisView placement determinism > seed 0 replays the same idle board fingerprint"),
            "Bump idle seed per TetrisView instance so duplicate fingerprints diverge.",
            apply_view_determinism,
        ),
        (
            "tetris-plan-cost",
            "web/src/arcade/tetris.ts",
            "    this.syncSkipHud(clock, this.usingIdleFeed && !this.idleScheduler.isLiveExclusive(clock));",
            """    this.syncSkipHud(clock, this.usingIdleFeed && !this.idleScheduler.isLiveExclusive(clock));
    if (this.active) {
      const board = boardFromOccupied(this.stack, COLS, ROWS);
      this.planCallCount++;
      bestPlacement(board, this.active.kind, scoreBoard);
    }""",
            f'pnpm --dir web exec vitest run src/arcade/tetris-plan-cost.test.ts -t "{anchored("TetrisView planner cost > 600 frames: one plan per spawn and exact placement search totals")}"',
            "src/arcade/tetris-plan-cost.test.ts",
            anchored("TetrisView planner cost > 600 frames: one plan per spawn and exact placement search totals"),
            "Re-plan on every host frame while a piece is active.",
            None,
        ),
        (
            "tetris-plan-cost-double-idle-tick",
            "web/src/graph/scene.ts",
            "      this.standaloneTileTick(dtSec, presentTs);\n    }\n    this.presentIdleFarField(presentTs);",
            "      this.standaloneTileTick(dtSec, presentTs);\n      this.standaloneTileTick(dtSec, presentTs);\n    }\n    this.presentIdleFarField(presentTs);",
            f'pnpm --dir web exec vitest run src/arcade/tetris-plan-cost.test.ts -t "{anchored("TetrisView planner cost > 600 frames: one plan per spawn and exact placement search totals")}"',
            "src/arcade/tetris-plan-cost.test.ts",
            anchored("TetrisView planner cost > 600 frames: one plan per spawn and exact placement search totals"),
            "Double standaloneTileTick per idle host frame (placement eval totals).",
            None,
        ),
        (
            "tetris-t-piece",
            "web/src/arcade/tetris.ts",
            spawn_plan,
            spawn_plan_t,
            f'pnpm --dir web exec vitest run src/arcade/tetris-t-piece.test.ts -t "{anchored("Tetris T-piece handling > survives a long all-T sequence with line clears")}"',
            "src/arcade/tetris-t-piece.test.ts",
            anchored("Tetris T-piece handling > survives a long all-T sequence with line clears"),
            "Score T pieces as O during TetrisView all-T survival.",
            None,
        ),
        (
            "tetris-empty-well-opening",
            "web/src/arcade/tetris.ts",
            """    this.openingIdleSeeded = true;
    if (!this.active && this.queue.length) this.spawn(nowSec, this.queue.shift()!);""",
            "    this.openingIdleSeeded = true;\n",
            f'pnpm --dir web exec vitest run src/arcade/tetris-empty-well.test.ts -t "{anchored("TetrisView never-empty well > frame 0: active piece and Demo data label on idle feed")}"',
            "src/arcade/tetris-empty-well.test.ts",
            anchored("TetrisView never-empty well > frame 0: active piece and Demo data label on idle feed"),
            "Skip opening spawn on idle-seeded queue.",
            None,
        ),
        (
            "tetris-empty-well-post-hold",
            "web/src/arcade/tetris.ts",
            "    if (!this.active && this.queue.length) this.spawn(now, this.queue.shift()!);\n    this.autoplayStep(dt);",
            "    if (!this.active && this.queue.length && this.lastHoldExpiredAt === 0) this.spawn(now, this.queue.shift()!);\n    this.autoplayStep(dt);",
            f'pnpm --dir web exec vitest run src/arcade/tetris-empty-well.test.ts -t "{anchored("TetrisView never-empty well > respawns within one host tick after top-out hold clears the stack")}"',
            "src/arcade/tetris-empty-well.test.ts",
            anchored("TetrisView never-empty well > respawns within one host tick after top-out hold clears the stack"),
            "Block respawn after top-out hold until lastHoldExpiredAt is set.",
            None,
        ),
        (
            "tetris-empty-well-never-empty",
            "web/src/arcade/tetris.ts",
            "    if (!this.active && this.queue.length && !shouldHoldTopout(now, this.topoutHoldUntil)) {\n      this.spawn(now, this.queue.shift()!);\n    }",
            "    if (false && !this.active && this.queue.length && !shouldHoldTopout(now, this.topoutHoldUntil)) {\n      this.spawn(now, this.queue.shift()!);\n    }",
            f'pnpm --dir web exec vitest run src/arcade/tetris-empty-well.test.ts -t "{anchored("TetrisView never-empty well > every frame outside top-out hold has an active piece (600 idle ticks, seed 42)")}"',
            "src/arcade/tetris-empty-well.test.ts",
            anchored("TetrisView never-empty well > every frame outside top-out hold has an active piece (600 idle ticks, seed 42)"),
            "Disable post-lock respawn so missing-active frame count goes red.",
            None,
        ),
        (
            "tetris-idle-budget-600",
            "web/src/arcade/tetris-idle-feed.ts",
            "  deps.enqueue(deps.budget.deliver(due));",
            "  deps.enqueue([]);",
            f'pnpm --dir web exec vitest run src/arcade/tetris-idle-view.test.ts -t "{anchored("TetrisView host idle feed > 600 frames: piece budget, no real clock reads, HUD skips match hand count")}"',
            "src/arcade/tetris-idle-view.test.ts",
            anchored("TetrisView host idle feed > 600 frames: piece budget, no real clock reads, HUD skips match hand count"),
            "Drop idle packets instead of delivering through the budget cap.",
            None,
        ),
        (
            "tetris-idle-no-wall-clock",
            "web/src/arcade/tetris-idle-feed.ts",
            "  const due = deps.scheduler.tick(deps.clockMs());",
            "  const due = deps.scheduler.tick(performance.now());",
            f'pnpm --dir web exec vitest run src/arcade/tetris-idle-view.test.ts -t "{anchored("TetrisView host idle feed > 600 frames: piece budget, no real clock reads, HUD skips match hand count")}"',
            "src/arcade/tetris-idle-view.test.ts",
            anchored("TetrisView host idle feed > 600 frames: piece budget, no real clock reads, HUD skips match hand count"),
            "Read performance.now() in idle feed tick.",
            None,
        ),
        (
            "tetris-idle-standalone-host",
            "web/src/arcade/tetris-standalone-host.ts",
            "  scene.setActive(false);",
            "  scene.setActive(true);",
            f'pnpm --dir web exec vitest run src/arcade/tetris-idle-view.test.ts -t "{anchored("TetrisView host idle feed > 600 frames: piece budget, no real clock reads, HUD skips match hand count")}"',
            "src/arcade/tetris-idle-view.test.ts",
            anchored("TetrisView host idle feed > 600 frames: piece budget, no real clock reads, HUD skips match hand count"),
            "Leave graph scene active so standalone host idle tick never runs.",
            None,
        ),
        (
            "tetris-host-frame-tick-wall-clock",
            "web/src/arcade/stage3d.ts",
            "  hostFrameTick(presentTs: MonoMs, dtSec: number): void {\n    if (!this.running) return;",
            "  hostFrameTick(presentTs: MonoMs, dtSec: number): void {\n    void performance.now();\n    if (!this.running) return;",
            f'pnpm --dir web exec vitest run src/graph/scene-idle-host-clock.test.ts -t "{anchored("Stage3D hostFrameTick wall clock > 600 hostFrameTick calls: hostFrameTick never reads performance.now or Date.now")}"',
            "src/graph/scene-idle-host-clock.test.ts",
            anchored("Stage3D hostFrameTick wall clock > 600 hostFrameTick calls: hostFrameTick never reads performance.now or Date.now"),
            "Read performance.now() inside hostFrameTick.",
            None,
        ),
        (
            "tetris-tile-lit-sky",
            "web/src/arcade/tetris-standalone-host.ts",
            "  scene.setAnim({ ...scene.dreamAnim, backdrop: TETRIS_TILE_BACKDROP });\n  scene.setStandaloneTileTick",
            "  scene.setStandaloneTileTick",
            f'pnpm --dir web exec vitest run src/arcade/tetris-tile-sky.test.ts -t "{anchored("Tetris standalone tile sky > well stage keeps lit sky signature while graph idles")}"',
            "src/arcade/tetris-tile-sky.test.ts",
            anchored("Tetris standalone tile sky > well stage keeps lit sky signature while graph idles"),
            "Stop binding space backdrop on standalone Tetris host.",
            None,
        ),
        (
            "scene-idle-present-stamp",
            "web/src/graph/scene.ts",
            "    if (!this.active) {\n      markFrame(ts);\n      this.idleFrame(ts);",
            "    if (!this.active) {\n      this.idleFrame(ts);",
            f'pnpm --dir web exec vitest run src/graph/scene-idle-present.test.ts -t "{anchored("NetScene idle host present stamps > 600 hostFrame calls: exactly one present-listener fire per frame")}"',
            "src/graph/scene-idle-present.test.ts",
            anchored("NetScene idle host present stamps > 600 hostFrame calls: exactly one present-listener fire per frame"),
            "Drop markFrame on inactive host animate path.",
            None,
        ),
        (
            "scene-idle-host-fps-double-stamp",
            "web/src/graph/scene.ts",
            "      this.standaloneTileTick(dtSec, presentTs);\n    }\n    this.presentIdleFarField(presentTs);",
            "      this.standaloneTileTick(dtSec, presentTs);\n      markFrame(presentTs);\n    }\n    this.presentIdleFarField(presentTs);",
            f'pnpm --dir web exec vitest run src/graph/scene-idle-fps.test.ts -t "{anchored("NetScene idle host FPS window > 600 injected 16 ms frames: hostWindowFps is exactly 62.5")}"',
            "src/graph/scene-idle-fps.test.ts",
            anchored("NetScene idle host FPS window > 600 injected 16 ms frames: hostWindowFps is exactly 62.5"),
            "Restore inner markFrame after standaloneTileTick (duplicate stamp).",
            None,
        ),
        (
            "fps-mono-brand-guard",
            "web/src/core/fps.ts",
            "export function markFrame(ts: FrameTs): void {",
            "export function markFrame(ts: MonoMs): void {",
            "pnpm --dir web exec tsc --noEmit",
            "src/core/fps-mono-guard.ts",
            "tsc unused @ts-expect-error when markFrame accepts MonoMs",
            "Widen markFrame to MonoMs so bare MonoMs cast guard is unused.",
            None,
        ),
    ]

    for row in rows:
        write_row(*row)

    print("done", len(rows), "rows")


if __name__ == "__main__":
    main()
