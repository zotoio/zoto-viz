/**
 * Plugin catalog load errors, logged once per file+message per page load with a fix hint.
 * Each catalog refresh used to re-log the same warnings (5 per refresh on a wall with stale
 * local zips), which also fed the page error reporter.
 */
const seen = new Set<string>();

export type CatalogHint = { level: "info" | "warn"; hint: string };

export function catalogErrorHint(message: string): CatalogHint {
  const owns = /src catalog owns id '([^']+)'/.exec(message);
  if (owns) {
    return {
      level: "info",
      hint: `a first-party pack '${owns[1]}' ships in plugins/src and wins; the local zip is ignored (delete it to silence this)`,
    };
  }
  if (/'idle' is a required property/.test(message)) {
    return {
      level: "warn",
      hint: "packs that declare graph capabilities must set viz.idle (and viz.graphWalk) in plugin.yml; see schema $defs/vizIdle, then re-zip",
    };
  }
  return { level: "warn", hint: "" };
}

/** Log one catalog error unless this file+message was already logged; returns true if logged. */
export function noteCatalogError(file: string | undefined, message: string, log: Pick<Console, "info" | "warn"> = console): boolean {
  const key = `${file ?? ""}\u0000${message}`;
  if (seen.has(key)) return false;
  seen.add(key);
  const { level, hint } = catalogErrorHint(message);
  log[level]("zoto-viz plugin:", file, message, ...(hint ? [`— ${hint}`] : []));
  return true;
}

export function resetCatalogWarningsForTests(): void { seen.clear(); }
