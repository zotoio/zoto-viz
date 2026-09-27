import type { Packet } from "../core/types";
import type { TetrisIdleScheduler } from "./tetris-idle-scheduler";
import type { TetrisTrafficBudget } from "./tetris-traffic-budget";

/** Host-injected clock + traffic budget for Tetris idle packets (no rAF wall clock). */
export interface TetrisIdleFeedDeps {
  clockMs: () => number;
  scheduler: TetrisIdleScheduler;
  budget: TetrisTrafficBudget;
  enqueue: (packets: Packet[]) => void;
}

/** One idle tick: scheduler due packets → budget cap → enqueue (live path uses the same budget). */
export function tickTetrisIdleFeed(deps: TetrisIdleFeedDeps, usingIdleFeed: boolean): void {
  if (!usingIdleFeed) return;
  const due = deps.scheduler.tick(deps.clockMs());
  if (!due.length) return;
  deps.enqueue(deps.budget.deliver(due));
}
