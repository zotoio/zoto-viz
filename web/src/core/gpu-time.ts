/**
 * Per-draw GPU elapsed time. The pane readout uses this so a heavy tile cannot
 * keep the number at the display refresh while its own draw is still on the GPU.
 */

interface TimerExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

interface Pending {
  gl: WebGL2RenderingContext;
  ext: TimerExt;
  query: WebGLQuery;
  done: (ms: number) => void;
}

const POOL_SIZE = 8;
const pending: Pending[] = [];
const free: WebGLQuery[] = [];

function timerExt(gl: WebGL2RenderingContext): TimerExt | null {
  return gl.getExtension("EXT_disjoint_timer_query_webgl2") as TimerExt | null;
}

/** Poll finished queries. Safe to call every frame. */
export function harvestGpu(): void {
  let i = 0;
  while (i < pending.length) {
    const p = pending[i]!;
    if (p.gl.isContextLost()) {
      pending.splice(i, 1);
      continue;
    }
    if (p.gl.getParameter(p.ext.GPU_DISJOINT_EXT)) {
      p.gl.deleteQuery(p.query);
      pending.splice(i, 1);
      continue;
    }
    if (!p.gl.getQueryParameter(p.query, p.gl.QUERY_RESULT_AVAILABLE)) {
      i++;
      continue;
    }
    const ns = p.gl.getQueryParameter(p.query, p.gl.QUERY_RESULT) as number;
    p.gl.deleteQuery(p.query);
    pending.splice(i, 1);
    if (ns > 0) p.done(ns / 1e6);
    // Deleted queries must not re-enter the pool — allocate fresh in timeGpu().
  }
}

/** Run `draw` and report its GPU time once the query resolves. No-ops the timing when the extension is missing. */
export function timeGpu(gl: WebGL2RenderingContext, draw: () => void, done: (ms: number) => void): void {
  harvestGpu();
  const ext = timerExt(gl);
  if (!ext) {
    draw();
    return;
  }
  let query = free.pop();
  if (!query) query = gl.createQuery();
  if (!query) {
    draw();
    return;
  }
  gl.beginQuery(ext.TIME_ELAPSED_EXT, query);
  try {
    draw();
  } finally {
    gl.endQuery(ext.TIME_ELAPSED_EXT);
  }
  pending.push({ gl, ext, query, done });
}
