/**
 * Partial redaction for screenshots and screen-sharing. A global switch; rendering code passes strings
 * through these helpers and gets them back untouched when redaction is off.
 *
 *   private IPv4  192.168.86.73        -> 192.168.xx.73      (subnet hidden, devices still distinguishable)
 *   public IPv4   54.211.171.167       -> 54.211.xx.xx
 *   IPv6          fd71:2f70:125f:…     -> fd71:2f70:…
 *   MAC           50:eb:71:8d:7c:b4    -> 50:eb:71:xx:xx:xx  (OUI kept, so the vendor still makes sense)
 *   public FQDN   api2.cursor.sh       -> ….cursor.sh
 *   local name    Android_0ZT9IUW6.local -> And….local ;  xps-zoto -> xps…
 */

export const redaction = { enabled: false };

const V4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const SECOND_LEVEL = new Set(["co", "com", "net", "org", "gov", "edu", "ac", "or", "ne"]);
const LOCAL_SUFFIX = /\.(local|lan|home|internal|localdomain|arpa)$/i;

function isPrivateV4(a: number, b: number): boolean {
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || a === 100 && b >= 64 && b <= 127;
}

export function rIp(ip: string): string {
  if (!redaction.enabled || !ip) return ip;
  const m = ip.match(V4);
  if (m) {
    const [, a, b, , d] = m;
    return isPrivateV4(Number(a), Number(b)) ? `${a}.${b}.xx.${d}` : `${a}.${b}.xx.xx`;
  }
  if (ip.includes(":")) {
    const groups = ip.split(":");
    return `${groups.slice(0, 2).join(":")}:…`;
  }
  return ip;
}

export function rCidr(cidr: string): string {
  if (!redaction.enabled || !cidr) return cidr;
  const [ip, len] = cidr.split("/");
  return len ? `${rIp(ip)}/${len}` : rIp(ip);
}

export function rMac(mac: string): string {
  if (!redaction.enabled || !mac) return mac;
  const p = mac.split(":");
  return p.length === 6 ? `${p.slice(0, 3).join(":")}:xx:xx:xx` : mac;
}

export function rName(name: string): string {
  if (!redaction.enabled || !name) return name;
  if (V4.test(name) || (name.includes(":") && !name.includes("."))) return rIp(name);
  const wild = name.startsWith("*.");
  const bare = wild ? name.slice(2) : name;
  // rDNS pointer names carry the address itself
  if (/\.in-addr\.arpa$/i.test(bare)) return "….in-addr.arpa";
  if (/\.ip6\.arpa$/i.test(bare)) return "….ip6.arpa";
  if (LOCAL_SUFFIX.test(bare) || !bare.includes(".")) {
    const dot = bare.indexOf(".");
    const host = dot < 0 ? bare : bare.slice(0, dot);
    const suffix = dot < 0 ? "" : bare.slice(dot);
    return `${host.slice(0, 3)}…${suffix}`;
  }
  const parts = bare.split(".");
  let keep = 2;
  if (parts.length >= 3 && SECOND_LEVEL.has(parts[parts.length - 2]) && parts[parts.length - 1].length === 2) keep = 3;
  const domain = parts.slice(-keep).join(".");
  if (parts.length <= keep) return wild ? `*.${domain}` : domain;
  return `${wild ? "*." : ""}….${domain}`;
}

/** Redact anything that looks like an address inside free text (ports lists, interface strings are left alone). */
export function rText(s: string): string {
  if (!redaction.enabled || !s) return s;
  return s.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, (ip) => rIp(ip));
}
