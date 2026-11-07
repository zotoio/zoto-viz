/**
 * Browser smokes seed their view in localStorage, but on first boot the UI loads the startup
 * profile from ~/.zoto-viz/profiles.yml (shipped: topology, autoconsent off) and that overwrites
 * the localStorage view. Seed the `user` profile and make it the startup default over the monitor
 * API before navigating, so the profile load applies the smoke's settings instead.
 */
import assert from "node:assert/strict";

const USER_ID = "user";

/** Settings shared by the sandbox smokes (merged over the UI's shipped defaults on load). */
export function smokeProfileSettings(mode, extra = {}) {
  return {
    mode,
    autoconsent: true,
    mic: "off",
    camera: "off",
    anim: { mosaic: "off" },
    operator: { tsPlugins: true },
    ...extra,
  };
}

export async function seedSmokeProfile(base, settings) {
  const root = base.replace(/\/?$/, "/");
  const sess = await fetch(`${root}api/session`);
  assert.equal(sess.status, 200, `session ${sess.status}`);
  const { csrf } = await sess.json();
  assert.ok(csrf, "csrf missing from /api/session");
  const headers = { "Content-Type": "application/json", "X-Zoto-Viz-Csrf": csrf };
  const list = await fetch(`${root}api/profiles`);
  assert.equal(list.status, 200, `profiles ${list.status}`);
  const { profiles = [] } = await list.json();
  const exists = profiles.some((p) => p.id === USER_ID);
  const write = exists
    ? await fetch(`${root}api/profiles/${USER_ID}`, { method: "PUT", headers, body: JSON.stringify({ settings }) })
    : await fetch(`${root}api/profiles`, {
      method: "POST",
      headers,
      body: JSON.stringify({ id: USER_ID, label: USER_ID, settings, make_default: true }),
    });
  assert.ok(write.ok, `seed profile ${write.status} ${await write.text()}`);
  const def = await fetch(`${root}api/profiles/default`, { method: "PUT", headers, body: JSON.stringify({ id: USER_ID }) });
  assert.ok(def.ok, `default profile ${def.status}`);
}

/**
 * PNG of one element's box. A locator screenshot first waits for the element to hold still across
 * animation frames, and a software-GL headless run can go longer than the timeout between frames;
 * a page screenshot clipped to the box does not wait for that.
 */
export async function screenshotBox(page, locator, timeout = 120_000) {
  await locator.waitFor({ state: "visible", timeout });
  // Do not use locator.boundingBox(): it waits for the element to stop moving, and packs such as
  // Backrooms chase the camera every frame so the stage never becomes "stable" on CI software GL.
  const box = await locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return null;
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });
  assert.ok(box, `no box to screenshot: ${JSON.stringify(box)}`);
  return page.screenshot({ type: "png", clip: box, timeout });
}
