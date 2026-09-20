/** NASA IOTD / APOD / Earth Observatory stills belong on carousel plugin views. */

const NASA_HOST = /(^|\.)nasa\.gov$/i;

function decodeProxyUrl(url: string): string {
  const raw = url.trim();
  if (!raw) return "";
  if (raw.startsWith("/api/sources/image")) {
    try {
      const q = new URL(raw, "http://local").searchParams.get("url") || "";
      return q.startsWith("https://") ? q : "";
    } catch {
      return "";
    }
  }
  return raw;
}

/** True for NASA Image of the Day, APOD, Earth Observatory, and other nasa.gov stills. */
export function isNasaStillUrl(url: string): boolean {
  const href = decodeProxyUrl(url);
  if (!href.startsWith("https://")) return false;
  try {
    return NASA_HOST.test(new URL(href).hostname);
  } catch {
    return false;
  }
}

export function assetIdFromHref(href: string): string | null {
  const m = href.trim().match(/^\/api\/ai\/assets\/([a-f0-9]{12,32})$/i);
  return m ? m[1]!.toLowerCase() : null;
}

/** Photo deco whose href or recorded origin is a NASA still. */
export function isNasaStillDeco(
  d: { src?: string; from?: string },
  origins?: Map<string, string> | Record<string, string> | null,
): boolean {
  if (d.from && isNasaStillUrl(d.from)) return true;
  if (d.src && isNasaStillUrl(d.src)) return true;
  const id = d.src ? assetIdFromHref(d.src) : null;
  if (!id || !origins) return false;
  const origin = origins instanceof Map ? origins.get(id) : origins[id];
  return !!origin && isNasaStillUrl(origin);
}
