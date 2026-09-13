/**
 * Partial redaction for screenshots and screen-sharing. A global switch; rendering code passes strings
 * through these helpers and gets them back untouched when redaction is off.
 *
 *   private IPv4  192.168.1.42         -> 192.168.xx.42      (subnet hidden, devices still distinguishable)
 *   public IPv4   203.0.113.10         -> 203.0.xx.xx
 *   IPv6          fd00:1111:2222:…    -> fd00:1111:…
 *   MAC           aa:bb:cc:dd:ee:ff    -> aa:bb:cc:xx:xx:xx  (OUI kept, so the vendor still makes sense)
 *   public FQDN   api.example.com      -> ….example.com
 *   local name    phone-ab12.local     -> pho….local ;  laptop-dev -> lap…
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

const MAC_IN_TEXT = /\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/gi;
const V4_IN_TEXT = /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g;
/** dashed quads as cloud providers embed them in hostnames: ec2-54-169-137-161…, ip-10-0-0-1 */
const DASHED_V4 = /\b(\d{1,3})-(\d{1,3})-(\d{1,3})-(\d{1,3})\b/g;
/** IPv6 candidates: hex groups joined by colons; checked in code so clock times (20:15:43) are left alone */
const V6_CANDIDATE = /(?<![\w:])(?:[0-9a-f]{0,4}:){2,7}[0-9a-f]{0,4}(?![\w:])/gi;
/** local / private host names anywhere in text */
const LOCAL_NAME_IN_TEXT = /\b[\w-]+(?:\.[\w-]+)*\.(?:local|lan|home|internal|localdomain|arpa)\b/gi;

function looksLikeV6(s: string): boolean {
  if (s.includes("xx")) return false;
  const groups = s.split(":");
  if (groups.some((g) => g.length > 4)) return false;
  // a real address has "::" or at least four groups, and a clock time never contains hex letters
  return s.includes("::") || (groups.length >= 4 && /[a-f]/i.test(s)) || (groups.length >= 5 && !s.includes("."));
}

/**
 * Redact anything that looks like an identifier inside free text: Wireshark info columns, NSE script output,
 * TXT records, certificate subjects, URLs, command lines. MACs first (an IPv6 scan would otherwise eat them),
 * then IPv4, dashed IPv4 in cloud hostnames, IPv6, then local host names. Port lists and interfaces are untouched.
 */
export function rText(s: string): string {
  if (!redaction.enabled || !s) return s;
  return s
    .replace(MAC_IN_TEXT, (m) => rMac(m.replace(/-/g, ":")))
    .replace(V4_IN_TEXT, (ip) => rIp(ip))
    .replace(DASHED_V4, (_m, a, b) => `${a}-${b}-xx-xx`)
    .replace(V6_CANDIDATE, (m) => (looksLikeV6(m) ? rIp(m) : m))
    .replace(LOCAL_NAME_IN_TEXT, (n) => rName(n));
}
