/** Shared helpers for headless sandbox smoke tests (per-pack HMAC tokens). */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export function packAssetUrl(base, token, packId, ...parts) {
  const root = base.replace(/\/?$/, "/");
  const segs = [encodeURIComponent(token), encodeURIComponent(packId), ...parts.map((p) => encodeURIComponent(p))];
  return `${root}pack-assets/${segs.join("/")}`;
}

/** Session-bound headers required for frame-bound pack-asset token verification. */
export function packAssetSessionHeaders(csrf) {
  return {
    Host: "127.0.0.1:7020",
    "X-Zoto-Viz-Csrf": csrf,
  };
}

/** Opaque-origin GET/HEAD to /pack-assets/… (smoke probes bootstrap JS). */
export function packAssetNullOriginGetHeaders(csrf) {
  return {
    ...packAssetSessionHeaders(csrf),
    Origin: "null",
  };
}

export async function fetchPackAssetToken(base, packId = "_sandbox") {
  const root = base.replace(/\/?$/, "/");
  const sess = await fetch(`${root}api/session`, { headers: { Host: "127.0.0.1:7020" } });
  assert.equal(sess.status, 200, `session ${sess.status}`);
  const { csrf } = await sess.json();
  assert.ok(csrf, "csrf missing from /api/session");
  const headers = {
    ...packAssetSessionHeaders(csrf),
    "Content-Type": "application/json",
  };
  const frameId = randomUUID();
  const reg = await fetch(`${root}api/pack-assets/frames`, {
    method: "POST",
    headers,
    body: JSON.stringify({ frameId }),
  });
  assert.equal(reg.status, 200, `pack frame register ${reg.status}`);
  let r = await fetch(`${root}api/pack-assets/token/${encodeURIComponent(packId)}`, {
    method: "POST",
    headers,
    body: JSON.stringify({ frameId }),
  });
  if (r.status === 403 && packId !== "_sandbox") {
    await fetch(`${root}api/plugins/${encodeURIComponent(packId)}/consent`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ consent: "reviewed" }),
    });
    r = await fetch(`${root}api/pack-assets/token/${encodeURIComponent(packId)}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ frameId }),
    });
  }
  assert.equal(r.status, 200, `pack token ${packId} ${r.status}`);
  const data = await r.json();
  assert.ok(data.token, "token missing from mint response");
  return { token: data.token, csrf, frameId };
}
