/** Same-origin stills (CSP `img-src 'self'`). HTTPS goes through the monitor proxy. */
export const IMAGE_TRIES = 3;
export const IMAGE_RETRY_MS = 450;
export const IMAGE_TIMEOUT_MS = 20_000;

export function stillSrc(url: string): string {
  const u = (url || "").trim();
  if (!u) return "";
  if (u.startsWith("/api/") || u.startsWith("data:") || u.startsWith("blob:")) return u;
  if (u.startsWith("/")) return u;
  if (u.startsWith("https://")) return `/api/sources/image?url=${encodeURIComponent(u)}`;
  return "";
}

export function retrySrc(src: string, attempt: number): string {
  if (attempt <= 0) return src;
  const sep = src.includes("?") ? "&" : "?";
  return `${src}${sep}_try=${attempt}`;
}

export function imageIsReady(el: HTMLImageElement): boolean {
  return el.complete && el.naturalWidth > 0;
}

type LoadOpts = {
  tries?: number;
  timeoutMs?: number;
  retryMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

function waitForImage(
  el: HTMLImageElement,
  src: string,
  timeoutMs: number,
): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (ok: boolean, err?: Error) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      el.onload = null;
      el.onerror = null;
      if (ok) resolve(el);
      else reject(err ?? new Error("image failed"));
    };
    const timer = window.setTimeout(() => finish(false, new Error("image timeout")), timeoutMs);
    el.onload = () => {
      if (imageIsReady(el)) finish(true);
      else finish(false, new Error("empty image"));
    };
    el.onerror = () => finish(false, new Error("image error"));
    if (el.getAttribute("src") !== src) el.src = src;
    else if (imageIsReady(el)) finish(true);
    else if (el.complete) finish(false, new Error("broken cache"));
  });
}

async function decodeImage(el: HTMLImageElement): Promise<void> {
  const dec = el.decode;
  if (typeof dec !== "function") return;
  try {
    await dec.call(el);
  } catch {
    if (!imageIsReady(el)) throw new Error("decode failed");
  }
}

/** Load `src` onto `el` with retries. Leaves a previous good frame on failure. */
export async function loadHtmlImage(
  el: HTMLImageElement,
  src: string,
  opts: LoadOpts = {},
): Promise<HTMLImageElement> {
  const href = stillSrc(src) || src;
  if (!href) throw new Error("image url required");
  const tries = Math.max(1, opts.tries ?? IMAGE_TRIES);
  const timeoutMs = opts.timeoutMs ?? IMAGE_TIMEOUT_MS;
  const retryMs = opts.retryMs ?? IMAGE_RETRY_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  el.decoding = "async";
  let last: Error | undefined;
  for (let i = 0; i < tries; i++) {
    const attempt = retrySrc(href, i);
    try {
      await waitForImage(el, attempt, timeoutMs);
      await decodeImage(el);
      if (imageIsReady(el)) return el;
      last = new Error("empty image");
    } catch (e) {
      last = e instanceof Error ? e : new Error("image failed");
    }
    if (i + 1 < tries) await sleep(retryMs * (i + 1));
  }
  throw last ?? new Error("image failed");
}

export function warmStill(url: string): void {
  const src = stillSrc(url);
  if (!src) return;
  void loadHtmlImage(new Image(), src).catch(() => {});
}
