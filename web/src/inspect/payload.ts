/**
 * Decode the captured head of one packet's transport payload (/api/payload) into something a viewer can read:
 * a headline, a few structured facts, an optional text preview, and a hex + ASCII dump. Pure functions over
 * bytes; nothing here touches the network or the DOM.
 */

export interface PayloadMsg {
  t: number;
  src: string;
  proto: string;
  size: number;
  ports: string;
  info: string;
  /** hex, at most PAYLOAD_BYTES of the monitor (512) */
  payload: string;
  captured: number;
  /** the payload's full length on the wire */
  total: number;
}

export interface PayloadDecode {
  /** what the bytes are: "TLS 1.2 record · application data" */
  title: string;
  /** structured facts, one per line */
  facts: string[];
  /** a text preview when the payload is (mostly) printable */
  text?: string;
  /** a note about what cannot be shown (encryption, truncation) */
  note?: string;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.replace(/[^0-9a-f]/gi, "");
  const out = new Uint8Array(clean.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

/** Classic 16-bytes-per-row dump: offset, hex pairs, printable ASCII. */
export function hexDump(b: Uint8Array): string {
  const rows: string[] = [];
  for (let off = 0; off < b.length; off += 16) {
    const chunk = b.subarray(off, off + 16);
    const hex = Array.from(chunk, (x) => x.toString(16).padStart(2, "0"));
    const left = hex.slice(0, 8).join(" "), right = hex.slice(8).join(" ");
    const asc = Array.from(chunk, (x) => (x >= 0x20 && x < 0x7f ? String.fromCharCode(x) : "·")).join("");
    rows.push(`${off.toString(16).padStart(4, "0")}  ${left.padEnd(23)}  ${right.padEnd(23)}  ${asc}`);
  }
  return rows.join("\n");
}

const TLS_CONTENT: Record<number, string> = { 20: "change cipher spec", 21: "alert", 22: "handshake", 23: "application data", 24: "heartbeat" };
const TLS_VERSION: Record<number, string> = { 0x0300: "SSL 3.0", 0x0301: "TLS 1.0", 0x0302: "TLS 1.1", 0x0303: "TLS 1.2", 0x0304: "TLS 1.3" };
const TLS_HANDSHAKE: Record<number, string> = {
  0: "hello request", 1: "client hello", 2: "server hello", 4: "new session ticket", 5: "end of early data", 8: "encrypted extensions",
  11: "certificate", 12: "server key exchange", 13: "certificate request", 14: "server hello done", 15: "certificate verify",
  16: "client key exchange", 20: "finished", 24: "key update", 254: "message hash",
};
const DNS_TYPE: Record<number, string> = {
  1: "A", 2: "NS", 5: "CNAME", 6: "SOA", 12: "PTR", 15: "MX", 16: "TXT", 28: "AAAA", 33: "SRV", 41: "OPT", 47: "NSEC", 65: "HTTPS", 255: "ANY",
};
const DHCP_MSG: Record<number, string> = { 1: "discover", 2: "offer", 3: "request", 4: "decline", 5: "ack", 6: "nak", 7: "release", 8: "inform" };
const HTTP_START = /^(GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH|CONNECT|TRACE|NOTIFY|M-SEARCH|SUBSCRIBE|UNSUBSCRIBE|DESCRIBE|SETUP|PLAY|TEARDOWN|REGISTER|INVITE) \S+ (HTTP|RTSP|SIP)\/\d(\.\d)?$|^(HTTP|RTSP|SIP)\/\d(\.\d)? \d{3}/;

export function decodePayload(m: PayloadMsg): PayloadDecode {
  const b = hexToBytes(m.payload);
  const trunc = m.total > b.length ? `showing the first ${b.length} of ${m.total.toLocaleString()} payload bytes` : undefined;
  if (!b.length) {
    return { title: /^TCP$/i.test(m.proto) ? "no payload · TCP header only" : "no payload", facts: [], note: m.total ? trunc : undefined };
  }
  const svc = servicePort(m.ports);
  const udp = /udp|dns|mdns|quic|dhcp|ntp|ssdp|llmnr|nbns/i.test(m.proto) || svc === 53 || svc === 5353 || svc === 67 || svc === 68 || svc === 123;
  const attempt = [
    () => decodeTls(b, m.total),
    () => decodeHttp(b),
    () => (udp && (svc === 53 || svc === 5353 || svc === 5355 || /dns|mdns|llmnr/i.test(m.proto)) ? decodeDns(b, svc === 5353) : null),
    () => ((udp && svc === 443) || /quic/i.test(m.proto) ? decodeQuic(b) : null),
    () => (udp && (svc === 67 || svc === 68 || /dhcp|bootp/i.test(m.proto)) ? decodeDhcp(b) : null),
    () => (udp && (svc === 123 || /ntp/i.test(m.proto)) ? decodeNtp(b) : null),
    () => decodeText(b),
  ];
  for (const f of attempt) {
    const d = f();
    if (d) return { ...d, note: [d.note, trunc].filter(Boolean).join(" · ") || undefined };
  }
  const e = entropy(b);
  if (/^TLS|^SSL/i.test(m.proto) || /Application Data|Continuation Data|reassembled PDU/i.test(m.info)) {
    // a segment from the middle of a TLS record: its header went by in an earlier segment
    return {
      title: `TLS · mid-record segment · ${m.total.toLocaleString()} bytes`,
      facts: [`entropy ${e.toFixed(2)} bits/byte`],
      note: ["ciphertext continuing a record whose header is in an earlier segment; only the endpoints, or a session-key log, can read it", trunc].filter(Boolean).join(" · "),
    };
  }
  return { title: `binary · ${m.total.toLocaleString()} bytes`, facts: [`entropy ${e.toFixed(2)} bits/byte${e > 7.2 ? " (compressed or encrypted)" : ""}`], note: trunc };
}

function servicePort(ports: string): number {
  const m = ports.match(/(\d+)\D+(\d+)/);
  if (!m) return 0;
  return Math.min(Number(m[1]), Number(m[2]));
}

function u16(b: Uint8Array, i: number): number { return (b[i]! << 8) | b[i + 1]!; }
function u32(b: Uint8Array, i: number): number { return ((b[i]! << 24) >>> 0) + (b[i + 1]! << 16) + (b[i + 2]! << 8) + b[i + 3]!; }
function hex(b: Uint8Array, i: number, n: number): string { return Array.from(b.subarray(i, i + n), (x) => x.toString(16).padStart(2, "0")).join(""); }
function ascii(b: Uint8Array, i: number, n: number): string { return String.fromCharCode(...b.subarray(i, i + n)); }

function entropy(b: Uint8Array): number {
  const c = new Float64Array(256);
  for (const x of b) c[x] = (c[x] ?? 0) + 1;
  let e = 0;
  for (const n of c) if (n) { const p = n / b.length; e -= p * Math.log2(p); }
  return e;
}

// ------------------------------------------------------------------ TLS

function decodeTls(b: Uint8Array, total: number): PayloadDecode | null {
  if (b.length < 5 || !TLS_CONTENT[b[0]!] || b[1] !== 3 || b[2]! > 4) return null;
  const facts: string[] = [];
  let off = 0, first = "";
  let encrypted = false;
  while (off + 5 <= b.length) {
    const type = b[off]!, ver = u16(b, off + 1), len = u16(b, off + 3);
    if (!TLS_CONTENT[type] || (ver >> 8) !== 3) break;
    const body = b.subarray(off + 5, Math.min(b.length, off + 5 + len));
    let what = TLS_CONTENT[type]!;
    if (type === 22 && body.length >= 4) {
      const ht = body[0]!;
      what = `handshake · ${TLS_HANDSHAKE[ht] ?? `type ${ht}`}`;
      if (ht === 1 || ht === 2) facts.push(...decodeHello(body, ht === 1));
    } else if (type === 23) {
      encrypted = true;
    } else if (type === 21 && body.length >= 2) {
      what = body.length === 2 && body[1]! < 200 ? `alert · ${body[0] === 1 ? "warning" : "fatal"} ${alertName(body[1]!)}` : "alert · encrypted";
    }
    if (!first) {
      first = `TLS · ${what}`;
      // the record layer's version is framing: hellos say 1.0 and every TLS 1.3 record says 1.2
      facts.unshift(`record layer ${TLS_VERSION[ver] ?? `version 0x${ver.toString(16)}`}`);
    }
    const spans = off + 5 + len > total; // the record really does run into the next TCP segment
    facts.push(`record ${TLS_CONTENT[type]} · ${len.toLocaleString()} bytes${spans ? " (continues in the next segment)" : ""}`);
    off += 5 + len;
  }
  if (!first) return null;
  return {
    title: first,
    facts: facts.slice(0, 12),
    note: encrypted ? "application data is ciphertext (AEAD); only the endpoints, or a session-key log, can read it" : undefined,
  };
}

function alertName(code: number): string {
  const names: Record<number, string> = { 0: "close notify", 10: "unexpected message", 20: "bad record mac", 40: "handshake failure", 42: "bad certificate", 48: "unknown ca", 70: "protocol version", 80: "internal error", 112: "unrecognized name" };
  return names[code] ?? `alert ${code}`;
}

/** ClientHello / ServerHello: version, SNI, ALPN, supported versions, key-share groups. */
function decodeHello(h: Uint8Array, client: boolean): string[] {
  const out: string[] = [];
  try {
    let p = 4; // handshake header
    const legacy = u16(h, p); p += 2;
    out.push(`legacy version ${TLS_VERSION[legacy] ?? legacy.toString(16)}`);
    p += 32; // random
    const sidLen = h[p]!; p += 1 + sidLen;
    if (client) {
      const csLen = u16(h, p); p += 2;
      out.push(`${csLen / 2} cipher suites`);
      p += csLen;
      const cmLen = h[p]!; p += 1 + cmLen;
    } else {
      out.push(`cipher suite 0x${hex(h, p, 2)}`); p += 3;
    }
    if (p + 2 > h.length) return out;
    const extLen = u16(h, p); p += 2;
    const end = Math.min(h.length, p + extLen);
    const groups: string[] = [];
    while (p + 4 <= end) {
      const et = u16(h, p), el = u16(h, p + 2); p += 4;
      const e = h.subarray(p, Math.min(end, p + el)); p += el;
      if (et === 0 && client && e.length >= 5) out.push(`SNI ${ascii(e, 5, u16(e, 3))}`);
      else if (et === 16) out.push(`ALPN ${alpnList(e).join(", ")}`);
      else if (et === 43) {
        if (client && e.length >= 1) out.push(`offers ${versions(e.subarray(1)).join(", ")}`);
        else if (e.length >= 2) out.push(`selected ${TLS_VERSION[u16(e, 0)] ?? e[1]}`);
      } else if (et === 51 && client && e.length >= 2) {
        let q = 2;
        const n = u16(e, 0);
        while (q + 4 <= Math.min(e.length, 2 + n)) { groups.push(groupName(u16(e, q))); q += 4 + u16(e, q + 2); }
      } else if (et === 51 && !client && e.length >= 2) groups.push(groupName(u16(e, 0)));
      else if (et === 0xfe0d) out.push("encrypted client hello (ECH)");
    }
    if (groups.length) out.push(`key share ${groups.join(", ")}`);
  } catch { /* a truncated hello: keep what parsed */ }
  return out;
}

function alpnList(e: Uint8Array): string[] {
  const out: string[] = [];
  let p = 2;
  while (p < e.length) { const n = e[p]!; out.push(ascii(e, p + 1, n)); p += 1 + n; }
  return out;
}

function versions(e: Uint8Array): string[] {
  const out: string[] = [];
  for (let p = 0; p + 2 <= e.length; p += 2) { const v = u16(e, p); out.push(TLS_VERSION[v] ?? ((v & 0x0f0f) === 0x0a0a ? "GREASE" : `0x${v.toString(16)}`)); }
  return out;
}

function groupName(g: number): string {
  const names: Record<number, string> = { 23: "P-256", 24: "P-384", 25: "P-521", 29: "X25519", 30: "X448", 0x6399: "X25519Kyber768", 0x11ec: "X25519MLKEM768", 0x11eb: "SecP256r1MLKEM768" };
  return names[g] ?? ((g & 0x0f0f) === 0x0a0a ? "GREASE" : `group 0x${g.toString(16)}`);
}

// ------------------------------------------------------------------ HTTP-shaped text (HTTP/1, RTSP, SIP, SSDP)

function decodeHttp(b: Uint8Array): PayloadDecode | null {
  const head = latin1(b.subarray(0, 4096));
  const nl = head.indexOf("\r\n");
  const line = nl < 0 ? head.slice(0, 200) : head.slice(0, nl);
  if (!HTTP_START.test(line)) return null;
  const blank = head.indexOf("\r\n\r\n");
  const headers = (blank < 0 ? head : head.slice(0, blank)).split("\r\n").slice(1).filter(Boolean);
  const proto = line.match(/(HTTP|RTSP|SIP)\/\d(\.\d)?/)?.[1] ?? "HTTP";
  const body = blank >= 0 ? head.slice(blank + 4) : "";
  return {
    title: `${proto === "HTTP" && /^(NOTIFY|M-SEARCH)/.test(line) ? "SSDP" : proto} · ${line}`,
    facts: headers.slice(0, 24),
    text: body ? body.slice(0, 1200) : undefined,
    note: blank < 0 ? "headers continue in the next segment" : undefined,
  };
}

function latin1(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < b.length; i += 4096) s += String.fromCharCode(...b.subarray(i, i + 4096));
  return s;
}

// ------------------------------------------------------------------ plain text

function decodeText(b: Uint8Array): PayloadDecode | null {
  let printable = 0;
  for (const x of b) if ((x >= 0x20 && x < 0x7f) || x === 0x0a || x === 0x0d || x === 0x09) printable++;
  if (b.length < 4 || printable / b.length < 0.92) return null;
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(b); } catch { text = latin1(b); }
  const json = text.trim().startsWith("{") || text.trim().startsWith("[");
  return { title: json ? "text · JSON" : "text", facts: [], text: text.slice(0, 2000) };
}

// ------------------------------------------------------------------ DNS / mDNS

function decodeDns(b: Uint8Array, mdns: boolean): PayloadDecode | null {
  if (b.length < 12) return null;
  const id = u16(b, 0), flags = u16(b, 2);
  const qd = u16(b, 4), an = u16(b, 6), ns = u16(b, 8), ar = u16(b, 10);
  if (qd + an + ns + ar > 400) return null;
  const qr = flags & 0x8000 ? "response" : "query";
  const rcode = flags & 0x0f;
  const facts = [`id 0x${id.toString(16).padStart(4, "0")} · ${qd} question${qd === 1 ? "" : "s"}, ${an} answer${an === 1 ? "" : "s"}, ${ns} authority, ${ar} additional${rcode ? ` · rcode ${rcode}` : ""}${flags & 0x0400 ? " · authoritative" : ""}${flags & 0x0100 ? " · recursion desired" : ""}`];
  let p = 12;
  try {
    for (let i = 0; i < qd && p < b.length; i++) {
      const [name, np] = dnsName(b, p); p = np;
      const type = u16(b, p), cls = u16(b, p + 2); p += 4;
      facts.push(`? ${name}  ${DNS_TYPE[type] ?? `type ${type}`}${cls & 0x8000 ? " (unicast reply)" : ""}`);
    }
    const rrs = an + ns + ar;
    for (let i = 0; i < rrs && p < b.length; i++) {
      const [name, np] = dnsName(b, p); p = np;
      const type = u16(b, p), ttl = u32(b, p + 4), rdl = u16(b, p + 8); p += 10;
      const rd = b.subarray(p, p + rdl);
      let val = "";
      if (type === 1 && rd.length === 4) val = Array.from(rd).join(".");
      else if (type === 28 && rd.length === 16) val = Array.from({ length: 8 }, (_, k) => u16(rd, k * 2).toString(16)).join(":").replace(/(^|:)0(:0)+(:|$)/, "::");
      else if (type === 12 || type === 5 || type === 2) val = dnsName(b, p)[0];
      else if (type === 33 && rd.length >= 6) val = `prio ${u16(rd, 0)} weight ${u16(rd, 2)} port ${u16(rd, 4)} ${dnsName(b, p + 6)[0]}`;
      else if (type === 16) { const parts: string[] = []; let q = 0; while (q < rd.length) { const n = rd[q]!; parts.push(ascii(rd, q + 1, n)); q += 1 + n; } val = parts.join(" · "); }
      else if (type === 41) val = `EDNS udp ${u16(b, p - 8)}`;
      else val = `${rdl} bytes`;
      const kind = i < an ? "=" : i < an + ns ? "ns" : "+";
      facts.push(`${kind} ${name}  ${DNS_TYPE[type] ?? `type ${type}`}  ${val}${ttl && type !== 41 ? `  ttl ${ttl}` : ""}`);
      p += rdl;
      if (facts.length > 30) { facts.push("…"); break; }
    }
  } catch { facts.push("… (truncated)"); }
  return { title: `${mdns ? "mDNS" : "DNS"} ${qr}`, facts };
}

function dnsName(b: Uint8Array, p: number, depth = 0): [string, number] {
  const labels: string[] = [];
  let end = -1;
  for (let guard = 0; guard < 64; guard++) {
    if (p >= b.length) break;
    const n = b[p]!;
    if (n === 0) { p++; break; }
    if ((n & 0xc0) === 0xc0) {
      if (end < 0) end = p + 2;
      if (depth > 5) break;
      const [rest] = dnsName(b, ((n & 0x3f) << 8) | b[p + 1]!, depth + 1);
      labels.push(rest);
      break;
    }
    labels.push(ascii(b, p + 1, n));
    p += 1 + n;
  }
  return [labels.join(".") || ".", end < 0 ? p : end];
}

// ------------------------------------------------------------------ QUIC

function decodeQuic(b: Uint8Array): PayloadDecode | null {
  if (b.length < 5) return null;
  const first = b[0]!;
  if (!(first & 0x40)) return null; // fixed bit
  if (first & 0x80) {
    const ver = u32(b, 1);
    const vname = ver === 1 ? "QUIC v1" : ver === 0x6b3343cf ? "QUIC v2" : ver === 0 ? "version negotiation" : (ver & 0x0f0f0f0f) === 0x0a0a0a0a ? "GREASE version" : `version 0x${ver.toString(16)}`;
    const types = ver === 1 ? ["initial", "0-RTT", "handshake", "retry"] : ["retry", "initial", "0-RTT", "handshake"];
    const type = types[(first >> 4) & 3]!;
    const dl = b[5] ?? 0, dcid = hex(b, 6, dl), sl = b[6 + dl] ?? 0, scid = hex(b, 7 + dl, sl);
    return {
      title: `${vname} · long header · ${type}`,
      facts: [`destination connection id ${dcid || "(empty)"}`, `source connection id ${scid || "(empty)"}`],
      note: type === "initial" ? "the initial packet's CRYPTO frame (ClientHello) is obfuscated with a key derived from the DCID" : "protected payload",
    };
  }
  return { title: "QUIC · short header · 1-RTT", facts: [`spin ${(first >> 5) & 1} · key phase ${(first >> 2) & 1}`], note: "1-RTT packets are encrypted; the connection id length is known only to the endpoints" };
}

// ------------------------------------------------------------------ DHCP

function decodeDhcp(b: Uint8Array): PayloadDecode | null {
  if (b.length < 240 || u32(b, 236) !== 0x63825363) return null;
  const facts = [
    `${b[0] === 1 ? "request from client" : "reply from server"} · transaction 0x${hex(b, 4, 4)}`,
    `client MAC ${Array.from(b.subarray(28, 34), (x) => x.toString(16).padStart(2, "0")).join(":")}`,
  ];
  const yi = Array.from(b.subarray(16, 20)).join(".");
  if (yi !== "0.0.0.0") facts.push(`your address ${yi}`);
  let p = 240, msg = "";
  while (p + 2 <= b.length) {
    const opt = b[p]!;
    if (opt === 255) break;
    if (opt === 0) { p++; continue; }
    const n = b[p + 1]!, v = b.subarray(p + 2, p + 2 + n); p += 2 + n;
    if (opt === 53 && n) msg = DHCP_MSG[v[0]!] ?? `type ${v[0]}`;
    else if (opt === 12) facts.push(`hostname ${ascii(v, 0, n)}`);
    else if (opt === 50) facts.push(`requested address ${Array.from(v).join(".")}`);
    else if (opt === 54) facts.push(`server ${Array.from(v).join(".")}`);
    else if (opt === 51 && n === 4) facts.push(`lease ${u32(v, 0)} s`);
    else if (opt === 3) facts.push(`router ${Array.from(v.subarray(0, 4)).join(".")}`);
    else if (opt === 6) facts.push(`dns ${Array.from({ length: n / 4 }, (_, k) => Array.from(v.subarray(k * 4, k * 4 + 4)).join(".")).join(", ")}`);
    else if (opt === 60) facts.push(`vendor class ${ascii(v, 0, n)}`);
    else if (opt === 55) facts.push(`asks for ${n} parameters`);
  }
  return { title: `DHCP ${msg || "message"}`, facts };
}

// ------------------------------------------------------------------ NTP

function decodeNtp(b: Uint8Array): PayloadDecode | null {
  if (b.length < 48) return null;
  const li = b[0]! >> 6, vn = (b[0]! >> 3) & 7, mode = b[0]! & 7;
  const modes = ["reserved", "symmetric active", "symmetric passive", "client", "server", "broadcast", "control", "private"];
  if (vn < 1 || vn > 4) return null;
  const tx = u32(b, 40) - 2208988800;
  return {
    title: `NTP v${vn} · ${modes[mode]}`,
    facts: [`stratum ${b[1]}${b[1] === 0 ? " (unspecified)" : b[1] === 1 ? " (primary reference)" : ""} · poll 2^${b[2]} s · precision 2^${(b[3]! << 24) >> 24} s`, ...(li === 3 ? ["clock unsynchronised"] : []),
      ...(tx > 0 ? [`transmit ${new Date(tx * 1000).toISOString()}`] : [])],
  };
}
