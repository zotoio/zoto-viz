/** 1 tick = 1/300 ms (integer budget clock). */
export const VIZ_TICKS_PER_MS = 300;

/** 16.7 ms wall budget in ticks. */
export const VIZ_WALL_BUDGET_TICKS = 5010;

/** Fixed debt cap: 3 × wall budget (never scales with tile share). */
export const VIZ_DEBT_CAP_TICKS = 15030;

/** HUD rolling window (1000 ms) in ticks — half-open (now − window, now]. */
export const VIZ_HUD_WINDOW_TICKS = 300000;

/** 60 Hz sim step in ticks. */
export const VIZ_CLOCK_STEP_TICKS = 5000;

/** Supported mosaic layouts: 1×, 2×2, 2×3, 2×4, 4×4 (at most 16 tiles). */
export const VIZ_MAX_ACTIVE_TILES = 16;

export const VIZ_COST_TICKS_4MS = 1200;
export const VIZ_COST_TICKS_10MS = 3000;
export const VIZ_COST_TICKS_20MS = 6000;
export const VIZ_COST_TICKS_50MS = 15000;
export const VIZ_COST_SPIKE_500MS = 150000;
