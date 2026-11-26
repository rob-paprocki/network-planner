// ipplan.js: the plan checker, carve and info, in JavaScript for the web page and the Worker.
// It mirrors skills/network-planner/scripts/jq/*.jq. Both run the shared cases in tests/cases/,
// so change them together. Plain arithmetic only: JS bitwise operators are 32-bit signed.

export const KINDS = ["fixed", "pool", "spare"];
export const HOWS = ["static", "reserved", "dynamic", "retire"];

const IPV4 = /^(0|[1-9][0-9]{0,2})(\.(0|[1-9][0-9]{0,2})){3}$/;

export function ip2n(s) {
  if (typeof s !== "string" || !IPV4.test(s)) return null;
  const o = s.split(".").map(Number);
  if (o.some((x) => x > 255)) return null;
  return ((o[0] * 256 + o[1]) * 256 + o[2]) * 256 + o[3];
}

export function n2ip(n) {
  return [Math.floor(n / 16777216) % 256, Math.floor(n / 65536) % 256, Math.floor(n / 256) % 256, n % 256].join(".");
}

export const isV6 = (s) => typeof s === "string" && s.includes(":");

export function cidr(s) {
  if (typeof s !== "string") return null;
  const m = /^([^/]+)\/([0-9]{1,2})$/.exec(s);
  if (!m) return null;
  const a = ip2n(m[1]);
  const p = Number(m[2]);
  if (a == null || p > 32) return null;
  const size = 2 ** (32 - p);
  const net = Math.floor(a / size) * size;
  return { addr: a, net, prefix: p, size, bcast: net + size - 1, aligned: a === net };
}

export const cidrStr = (c) => `${n2ip(c.net)}/${c.prefix}`;
export const maskStr = (c) => n2ip(4294967296 - c.size);
export const firstHost = (c) => (c.prefix >= 31 ? c.net : c.net + 1);
export const lastHost = (c) => (c.prefix >= 31 ? c.bcast : c.bcast - 1);
export const usable = (c) => (c.prefix === 32 ? 1 : c.prefix === 31 ? 2 : c.size - 2);
export const reserved = (c, n) => c.prefix < 31 && (n === c.net || n === c.bcast);
export const contains = (c, n) => n >= c.net && n <= c.bcast;
export const containsC = (outer, inner) => inner.net >= outer.net && inner.bcast <= outer.bcast;
export const overlaps = (a, b) => a.net <= b.bcast && b.net <= a.bcast;

/** Smallest prefix whose usable count holds `hosts` plus a gateway, or null. */
export function prefixFor(hosts) {
  for (let p = 30; p >= 0; p--) if (2 ** (32 - p) - 2 >= hosts + 1) return p;
  return null;
}

const J = (v) => (v === undefined ? "null" : JSON.stringify(v));
/** A value the way jq's string interpolation writes it: strings as-is, anything else as JSON. */
const S = (v) => (typeof v === "string" ? v : J(v));
/** jq's `a // b`: the default when the value is missing, null or false. */
const alt = (v, d) => (v == null || v === false ? d : v);
const E = (where, code, message) => ({ level: "error", where, code, message });
const W = (where, code, message) => ({ level: "warning", where, code, message });

function badAddr(w, field, v) {
  return isV6(v)
    ? E(w, "ipv6-unsupported", `${field} ${v} is IPv6; this version plans IPv4 only.`)
    : E(w, "bad-address", `${field} ${J(v)} isn't an IPv4 address like 192.0.2.10.`);
}
function badCidr(w, field, v) {
  return isV6(v)
    ? E(w, "ipv6-unsupported", `${field} ${v} is IPv6; this version plans IPv4 only.`)
    : E(w, "bad-cidr", `${field} ${J(v)} isn't a CIDR range like 192.0.2.0/24.`);
}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
/** The object entries of a list; anything else yields nothing. shapeErrors reports the rest. */
export const objectsIn = (v) => (Array.isArray(v) ? v.filter(isObj) : []);
/** A value as JSON with object keys sorted, so two values get the same text exactly when jq's == calls them equal. */
const K = (v) => JSON.stringify(v ?? null, (k, x) => (isObj(x) ? Object.fromEntries(Object.keys(x).sort().map((q) => [q, x[q]])) : x));

function shapeErrors(where, field, v, out) {
  if (v == null) return;
  if (!Array.isArray(v)) out.push(E(where, "bad-structure", `"${field}" must be a list.`));
  else if (v.some((x) => !isObj(x))) out.push(E(where, "bad-structure", `Every entry in "${field}" must be an object.`));
}

function segments(plan) {
  return objectsIn(plan.segments).map((s, i) => {
    const id = alt(s.id, `#${i + 1}`);
    return {
      i, id, raw: s, c: cidr(s.cidr), label: `segment ${id}`, gw: ip2n(s.gateway),
      blocks: objectsIn(s.blocks).map((b) => ({ raw: b, name: alt(b.name, "unnamed"), kind: alt(b.kind, "fixed"), s: ip2n(b.start), e: ip2n(b.end) })),
      devices: objectsIn(s.devices).map((d) => ({ raw: d, name: alt(d.name, "unnamed"), how: alt(d.how, "reserved"), n: ip2n(d.ip), cur: ip2n(d.current_ip) })),
    };
  });
}

// Ranges devices can't use, the shared carrier-grade NAT range, and the ranges where a plan is
// expected to live (private and documentation). Anything else is public address space.
const SPECIAL = [
  ["0.0.0.0/8", 'the "this network" block'], ["127.0.0.0/8", "the loopback range"], ["169.254.0.0/16", "the link-local range"],
  ["224.0.0.0/4", "the multicast range"], ["240.0.0.0/4", "the reserved block"],
].map(([r, what]) => ({ r, what, c: cidr(r) }));
const CGNAT = cidr("100.64.0.0/10");
const PLANNABLE = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "192.0.2.0/24", "198.51.100.0/24", "203.0.113.0/24"].map(cidr);

function rangeFindings(w, raw, c, warn, out) {
  const s = SPECIAL.find((x) => overlaps(x.c, c));
  if (s) out.push(E(w, "special-range", `${raw} overlaps ${s.what} (${s.r}), which devices can't use as normal addresses.`));
  else if (!warn) return;
  else if (overlaps(CGNAT, c)) out.push(W(w, "cgnat-range", `${raw} is in the carrier-grade NAT range (100.64.0.0/10). Use it only if you're sure your ISP and VPNs don't.`));
  else if (!PLANNABLE.some((p) => containsC(p, c)))
    out.push(W(w, "public-range", `${raw} is public address space. That's right only if your organisation owns it; private networks use 10.0.0.0/8, 172.16.0.0/12 or 192.168.0.0/16.`));
}

const blockOf = (g, n) => g.blocks.find((b) => b.s != null && b.e != null && n >= b.s && n <= b.e) || null;

/** What's wrong with a segment's "shares_vlan_with", or null when it names a segment on the same VLAN and site.
 * Only called when the field is present. */
function vlanShareProblem(g, segs) {
  const raw = g.raw, v = raw.shares_vlan_with;
  if (typeof v !== "string") return '"shares_vlan_with" must be the id of another segment.';
  if (v === raw.id) return '"shares_vlan_with" names this segment itself.';
  const t = segs.find((x) => x.raw.id === v);
  if (!t) return `"shares_vlan_with" names segment ${v}, which isn't in the plan.`;
  if (K(t.raw.site) !== K(raw.site)) return `Shares a VLAN with segment ${v}, which is at a different site.`;
  if (raw.vlan == null || t.raw.vlan == null) return `Shares a VLAN with segment ${v}, so both need the same "vlan".`;
  if (K(t.raw.vlan) !== K(raw.vlan)) return `Shares a VLAN with segment ${v}, but that segment is on VLAN ${S(t.raw.vlan)} and this one is on VLAN ${S(raw.vlan)}.`;
  return null;
}
const sharesVlan = (g, segs) => g.raw.shares_vlan_with != null && vlanShareProblem(g, segs) == null;

function checkSegment(g, segs, space, out) {
  const L = g.label, raw = g.raw, c = g.c;
  shapeErrors(L, "blocks", raw.blocks, out);
  shapeErrors(L, "devices", raw.devices, out);
  if (raw.id == null) out.push(E(L, "missing-id", 'Give the segment a short "id", such as "users".'));
  if (raw.name == null) out.push(W(L, "missing-name", 'Give the segment a "name" people will recognise.'));
  if (raw.cidr == null) out.push(E(L, "missing-cidr", 'The segment needs a "cidr", such as 192.0.2.0/26.'));
  else if (c == null) out.push(badCidr(L, "cidr", raw.cidr));
  else if (!c.aligned) out.push(E(L, "misaligned-cidr", `${raw.cidr} doesn't start on a /${c.prefix} boundary. Did you mean ${cidrStr(c)}?`));
  if (c && c.aligned) rangeFindings(L, raw.cidr, c, true, out);
  if (raw.vlan != null && (typeof raw.vlan !== "number" || !Number.isInteger(raw.vlan) || raw.vlan < 1 || raw.vlan > 4094))
    out.push(E(L, "vlan-range", `VLAN ${J(raw.vlan)} is outside 1-4094.`));
  if (raw.shares_vlan_with != null) {
    const p = vlanShareProblem(g, segs);
    if (p) out.push(E(L, "bad-vlan-share", p));
  }
  if (c && space.length > 0 && !space.some((sp) => sp.c && containsC(sp.c, c)))
    out.push(E(L, "outside-space", `${raw.cidr} isn't inside the plan's address_space.`));

  // gateway
  if (raw.gateway == null) {
    if (c && c.prefix < 31) out.push(W(L, "no-gateway", `No gateway set. Most segments use the first usable address, ${n2ip(firstHost(c))}.`));
  } else if (g.gw == null) out.push(badAddr(L, "gateway", raw.gateway));
  else if (c) {
    const gb = blockOf(g, g.gw);
    if (!contains(c, g.gw)) out.push(E(L, "gateway-outside", `Gateway ${raw.gateway} isn't inside ${raw.cidr}.`));
    else if (reserved(c, g.gw)) out.push(E(L, "gateway-reserved", `Gateway ${raw.gateway} is the segment's network or broadcast address.`));
    else if (gb && gb.kind === "pool") out.push(E(L, "gateway-in-pool", `Gateway ${raw.gateway} is inside pool block ${J(gb.name)}, so DHCP could give it out.`));
  }

  // blocks
  for (const b of g.blocks) {
    const BL = `${L}, block ${b.name}`;
    if (!KINDS.includes(b.kind)) out.push(E(BL, "block-kind", `kind ${J(b.kind)} must be fixed, pool or spare.`));
    if (b.s == null) out.push(badAddr(BL, "start", b.raw.start));
    if (b.e == null) out.push(badAddr(BL, "end", b.raw.end));
    if (b.s == null || b.e == null) continue;
    if (b.s > b.e) out.push(E(BL, "block-order", `Starts at ${b.raw.start}, after its end ${b.raw.end}.`));
    else if (!c) continue;
    else if (!(contains(c, b.s) && contains(c, b.e))) out.push(E(BL, "block-outside", `${b.raw.start}-${b.raw.end} runs outside ${raw.cidr}.`));
    else if (c.prefix < 31 && (b.s === c.net || b.e === c.bcast))
      out.push(W(BL, "block-reserved", `Includes the segment's network or broadcast address. Keep it within ${n2ip(firstHost(c))}-${n2ip(lastHost(c))}.`));
  }
  const bs = g.blocks.filter((b) => b.s != null && b.e != null && b.s <= b.e);
  for (let x = 0; x < bs.length; x++)
    for (let y = x + 1; y < bs.length; y++)
      if (bs[x].s <= bs[y].e && bs[y].s <= bs[x].e) out.push(E(`${L}, block ${bs[x].name}`, "block-overlap", `Overlaps block ${bs[y].name}.`));
  if (!g.blocks.some((b) => b.kind === "pool") && g.devices.some((d) => d.how === "dynamic"))
    out.push(E(L, "no-pool", "Devices are marked dynamic, but the segment has no pool block."));

  // devices
  for (const d of g.devices) {
    const DL = `${L}, device ${d.name}`, dr = d.raw;
    if (dr.name == null) out.push(E(DL, "missing-name", 'A device has no "name".'));
    if (!HOWS.includes(d.how)) out.push(E(DL, "device-how", `how ${J(d.how)} must be static, reserved, dynamic or retire.`));
    if (dr.current_ip != null && d.cur == null) out.push(badAddr(DL, "current_ip", dr.current_ip));
    if (dr.gateway === true && d.how !== "retire" && g.gw != null && d.n != null && d.n !== g.gw)
      out.push(W(DL, "gateway-mismatch", `Marked as the gateway, but the segment's gateway is ${raw.gateway}, not ${dr.ip}.`));
    // "runs_on" names the device this one runs on (a VM on its hypervisor). Retiring devices count as devices.
    if (dr.runs_on != null) {
      const v = dr.runs_on;
      if (typeof v !== "string") out.push(E(DL, "bad-runs-on", '"runs_on" must be the name of another device.'));
      else if (v === dr.name) out.push(E(DL, "bad-runs-on", '"runs_on" names this device itself.'));
      else if (!segs.some((x) => x.devices.some((o) => o.raw.name === v)))
        out.push(W(DL, "runs-on-missing", `"runs_on" names ${v}, which isn't a device in the plan.`));
    }
    if (d.how === "retire") continue;
    if (dr.ip == null) {
      if (d.how !== "dynamic") out.push(E(DL, "needs-address", `A ${d.how} device needs a planned "ip".`));
      continue;
    }
    if (d.n == null) { out.push(badAddr(DL, "ip", dr.ip)); continue; }
    if (!c) continue;
    if (!contains(c, d.n)) { out.push(E(DL, "device-outside", `${dr.ip} isn't inside ${raw.cidr}.`)); continue; }
    if (reserved(c, d.n)) { out.push(E(DL, "device-reserved", `${dr.ip} is the segment's network or broadcast address.`)); continue; }
    if (g.gw != null && d.n === g.gw && dr.gateway !== true) {
      out.push(E(DL, "device-on-gateway", `${dr.ip} is the segment's gateway. If this device is the gateway, add "gateway": true.`));
      continue;
    }
    const b = blockOf(g, d.n);
    if (g.blocks.length > 0 && b == null) out.push(W(DL, "no-block", `${dr.ip} is in no block.`));
    else if (b == null) { /* no blocks at all: nothing to say */ }
    else if (b.kind === "pool" && d.how !== "dynamic")
      out.push(E(DL, "fixed-in-pool", `${dr.ip} is a ${d.how} address inside pool block ${J(b.name)}. DHCP could give it to another device as well.`));
    else if (b.kind !== "pool" && d.how === "dynamic") out.push(W(DL, "dynamic-outside-pool", `Marked dynamic, but ${dr.ip} is outside the pool.`));
    else if (b.kind === "spare") out.push(W(DL, "in-spare", `${dr.ip} is in the spare block ${b.name}.`));
    if (c.prefix < 24 && (d.n % 256 === 0 || d.n % 256 === 255))
      out.push(W(DL, "edge-octet", `${dr.ip} is valid in a /${c.prefix}, but some devices refuse addresses ending in .0 or .255.`));
  }
}

/** Check a plan object. Returns [{level, where, code, message}]. */
export function check(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return [E("plan", "not-an-object", "The plan must be a JSON object.")];
  const out = [];
  const segs = segments(plan);
  const asp = plan.address_space ?? [];
  const space = (Array.isArray(asp) ? asp : [asp]).map((r) => ({ raw: r, c: cidr(r) }));
  if (plan.schema !== 1) out.push(E("plan", "schema", 'Set "schema": 1 at the top of the plan.'));
  shapeErrors("plan", "segments", plan.segments, out);
  if (segs.length === 0) out.push(E("plan", "no-segments", "The plan has no segments yet."));
  for (const sp of space) {
    if (sp.c == null) out.push(badCidr("address_space", "range", sp.raw));
    else if (!sp.c.aligned) out.push(E("address_space", "misaligned-cidr", `${sp.raw} doesn't start on a /${sp.c.prefix} boundary. Did you mean ${cidrStr(sp.c)}?`));
    else rangeFindings("address_space", sp.raw, sp.c, false, out);
  }
  for (const g of segs) checkSegment(g, segs, space, out);
  const cs = segs.filter((g) => g.c);
  for (let x = 0; x < cs.length; x++)
    for (let y = x + 1; y < cs.length; y++)
      if (overlaps(cs[x].c, cs[y].c))
        out.push(E(cs[x].label, "segment-overlap", `${cs[x].raw.cidr} overlaps segment ${cs[y].id} (${cs[y].raw.cidr}).`));
  const groups = (items, key) => {
    const m = new Map();
    for (const it of items) { const k = K(key(it)); if (!m.has(k)) m.set(k, []); m.get(k).push(it); }
    return [...m.values()].filter((v) => v.length > 1);
  };
  for (const grp of groups(segs.filter((g) => g.raw.id != null), (g) => g.raw.id))
    out.push(E(`segment ${grp[0].raw.id}`, "duplicate-id", `${grp.length} segments share the id ${J(grp[0].raw.id)}.`));
  // VLAN numbers only have to be unique within a site; segments with no site share one scope. Several
  // subnets on one VLAN are fine when all but one of them say so with a valid "shares_vlan_with".
  for (const grp of groups(segs.filter((g) => g.raw.vlan != null), (g) => [g.raw.site ?? null, g.raw.vlan])) {
    if (grp.filter((g) => !sharesVlan(g, segs)).length < 2) continue;
    const at = grp[0].raw.site != null ? ` at site ${S(grp[0].raw.site)}` : "";
    const v = S(grp[0].raw.vlan);
    out.push(W(`vlan ${v}${at}`, "duplicate-vlan",
      `Segments ${grp.map((g) => g.id).join(", ")} share VLAN ${v}${at}. If that's on purpose, add "shares_vlan_with" to all but one of them.`));
  }
  const live = segs.flatMap((g) => g.devices.filter((d) => d.how !== "retire" && d.n != null).map((d) => ({ n: d.n, name: d.name, sid: g.id })));
  for (const grp of groups(live, (d) => d.n))
    out.push(E(`address ${n2ip(grp[0].n)}`, "duplicate-address", `Planned for more than one device: ${grp.map((d) => `${d.name} (${d.sid})`).join(", ")}.`));
  return out;
}

/** Describe one CIDR range. */
export function info(s) {
  const x = cidr(s);
  if (!x) return { ok: false, error: isV6(s) ? `${s} is IPv6; this version handles IPv4 only.` : `${J(s)} isn't an IPv4 CIDR range like 192.0.2.0/24.` };
  return {
    ok: true, input: s, network: cidrStr(x), aligned: x.aligned, prefix: x.prefix, mask: maskStr(x),
    addresses: x.size, usable: usable(x), first: n2ip(firstHost(x)), last: n2ip(lastHost(x)),
    broadcast: x.prefix >= 31 ? null : n2ip(x.bcast),
    scope: scopeOf(x), class: classOf(x.net),
  };
}

/** The pre-1993 class, from the first number. Still taught (Network+), never used for routing now. */
export function classOf(n) {
  const o = Math.floor(n / 16777216);
  return o < 128 ? "A" : o < 192 ? "B" : o < 224 ? "C" : o < 240 ? "D" : "E";
}

const SCOPES = [
  ["0.0.0.0/8", '"this network" block (not for hosts)'], ["127.0.0.0/8", "loopback (not for hosts)"],
  ["169.254.0.0/16", "link-local (not for hosts)"], ["224.0.0.0/4", "multicast (not for hosts)"],
  ["240.0.0.0/4", "reserved (not for hosts)"], ["100.64.0.0/10", "carrier-grade NAT (shared)"],
  ["10.0.0.0/8", "private (RFC 1918)"], ["172.16.0.0/12", "private (RFC 1918)"], ["192.168.0.0/16", "private (RFC 1918)"],
  ["192.0.2.0/24", "documentation (RFC 5737)"], ["198.51.100.0/24", "documentation (RFC 5737)"],
  ["203.0.113.0/24", "documentation (RFC 5737)"],
].map(([r, what]) => ({ c: cidr(r), what }));
/** What kind of space a parsed range is in. */
export function scopeOf(x) {
  const s = SCOPES.find((e) => overlaps(e.c, x));
  return s ? s.what : "public";
}

/** Size and place segments. requests: [{name, hosts}], avoid: [cidr strings]. */
export function carve(parent, requests, avoid = []) {
  const P = cidr(parent);
  if (!P) return { ok: false, error: `${J(parent)} isn't an IPv4 CIDR range like 192.0.2.0/24.` };
  if (!P.aligned) return { ok: false, error: `${parent} doesn't start on a /${P.prefix} boundary. Did you mean ${cidrStr(P)}?` };
  const names = requests.map((r) => r.name);
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  if (dup.length) return { ok: false, error: `Each name once (repeated: ${[...new Set(dup)].join(", ")}).` };
  const bad = requests.filter((r) => !Number.isInteger(r.hosts) || r.hosts < 0);
  if (bad.length) return { ok: false, error: `Host counts must be whole numbers (${bad.map((r) => r.name).join(", ")}).` };
  const av = avoid.map(cidr).filter(Boolean);
  const sized = requests.map((r, order) => {
    const prefix = prefixFor(r.hosts);
    return { ...r, order, prefix, size: prefix == null ? null : 2 ** (32 - prefix) };
  });
  const tooBig = sized.filter((r) => r.prefix == null || r.prefix < P.prefix);
  if (tooBig.length) return { ok: false, error: `${tooBig.map((r) => `${r.name} (${r.hosts} hosts)`).join(", ")} won't fit in ${parent} even on its own.` };
  const taken = [...av], placed = [], failed = [];
  for (const r of [...sized].sort((a, b) => b.size - a.size || a.order - b.order)) {
    let pos = P.net, done = false;
    while (!done && pos + r.size - 1 <= P.bcast) {
      const cand = { net: pos, bcast: pos + r.size - 1 };
      const o = taken.find((t) => overlaps(t, cand));
      if (!o) done = true;
      else pos = Math.ceil((o.bcast + 1) / r.size) * r.size;
    }
    if (!done) { failed.push(r); continue; }
    const c = { net: pos, prefix: r.prefix, size: r.size, bcast: pos + r.size - 1 };
    taken.push(c);
    placed.push({ ...r, c });
  }
  if (failed.length)
    return { ok: false, error: `Ran out of room in ${parent} for: ${failed.map((r) => `${r.name} (needs a /${r.prefix})`).join(", ")}. Try a bigger range or fewer hosts.` };
  const used = placed.reduce((s, r) => s + r.c.size, 0);
  const held = av.filter((a) => overlaps(a, P)).reduce((s, a) => s + a.size, 0);
  return {
    ok: true, parent,
    segments: placed.sort((a, b) => a.c.net - b.c.net).map((r) => ({
      id: r.name, name: r.name, cidr: cidrStr(r.c), gateway: n2ip(firstHost(r.c)), hosts_asked: r.hosts,
      usable: usable(r.c), first: n2ip(firstHost(r.c)), last: n2ip(lastHost(r.c)), blocks: [], devices: [],
    })),
    free: P.size - used - held,
  };
}

/**
 * Render a plan as Markdown tables, exactly as `ipplan summary` (summary.jq) does. Both read values
 * the same way: null, false and "" count as missing, a value that isn't a string prints as JSON, and
 * a list keeps only its object entries.
 */
export function summary(plan) {
  const has = (v) => !(v == null || v === false || v === "");
  const or = (v, d) => (has(v) ? v : d);
  const txt = (v) => (v == null ? "" : S(v));
  const same = (a, b) => J(a) === J(b);
  const cell = (v) => txt(v).replace(/\|/g, "\\|").replace(/\n/g, " ");
  const row = (a) => `| ${a.map(cell).join(" | ")} |`;
  const head = (cols) => [row(cols), row(cols.map(() => "---"))];
  const rng = (s, e) => (same(s, e) ? s : `${txt(s)} - ${txt(e)}`);
  const segName = (s) => or(s.name, s.id);
  const devName = (d) => or(d.name, "unnamed");
  const devs = (s) => objectsIn(s.devices);
  const segs = objectsIn(plan.segments).map((s) => ({ ...s, c: cidr(s.cidr) }));
  const live = (s) => devs(s).filter((d) => d.how !== "retire" && d.gateway !== true);
  const space = Array.isArray(plan.address_space) ? plan.address_space : [];
  const L = [`# ${txt(or(plan.name, "Network plan"))}`, ""];
  if (space.length) L.push(`Address space: ${space.map((a) => `\`${txt(a)}\``).join(", ")}`);
  if (has(plan.notes)) L.push("", txt(plan.notes));
  const sites = segs.some((s) => s.site != null);
  // The device tables get a "Runs on" column only when some device says what it runs on.
  const runsOn = segs.some((s) => devs(s).some((d) => typeof d.runs_on === "string"));
  L.push("", "## Segments", "", ...head([...(sites ? ["Site"] : []), "Segment", "VLAN", "Network", "Mask", "Gateway", "Usable", "DHCP pool", "Devices"]));
  for (const s of segs) {
    const pools = objectsIn(s.blocks).filter((b) => b.kind === "pool").map((b) => txt(rng(b.start, b.end)));
    const v = S(or(s.vlan, "-"));
    const vlan = typeof s.shares_vlan_with === "string" ? `${v} (shared with ${s.shares_vlan_with})` : v;
    L.push(row([...(sites ? [or(s.site, "-")] : []), segName(s), vlan, or(s.cidr, "-"), s.c ? maskStr(s.c) : "-", or(s.gateway, "-"), s.c ? usable(s.c) : "-", pools.length ? pools.join(", ") : "none", live(s).length]));
  }
  for (const s of segs) {
    const blocks = objectsIn(s.blocks), ds = devs(s);
    L.push("", `## ${txt(segName(s))}${has(s.cidr) ? ` (\`${txt(s.cidr)}\`)` : ""}`, "");
    if (has(s.purpose)) L.push(txt(s.purpose), "");
    L.push(`First usable ${s.c ? n2ip(firstHost(s.c)) : "-"}, last usable ${s.c ? n2ip(lastHost(s.c)) : "-"}.`);
    if (blocks.length) {
      L.push("", ...head(["Block", "Range", "Kind", "Size", "Used"]));
      for (const b of blocks) {
        const lo = ip2n(b.start), hi = ip2n(b.end);
        const inBlock = (d) => { const n = ip2n(d.ip); return n != null && lo != null && hi != null && n >= lo && n <= hi; };
        const used = ds.filter((d) => d.how !== "retire" && inBlock(d)).length;
        L.push(row([or(b.name, "unnamed"), rng(b.start, b.end), or(b.kind, "fixed"), lo != null && hi != null ? hi - lo + 1 : "-", used]));
      }
    }
    if (ds.length) {
      L.push("", ...head(["Device", "Address", "How", "Role", ...(runsOn ? ["Runs on"] : []), "Moves from"]));
      const sorted = [...ds].sort((a, b) => (ip2n(a.ip) ?? 4294967296) - (ip2n(b.ip) ?? 4294967296));
      for (const d of sorted)
        L.push(row([devName(d), has(d.ip) ? d.ip : d.how === "dynamic" ? "from the pool" : "-", or(d.how, "reserved"), or(d.role, ""),
          ...(runsOn ? [typeof d.runs_on === "string" ? d.runs_on : ""] : []), has(d.current_ip) && !same(d.current_ip, d.ip) ? d.current_ip : ""]));
    }
  }
  const all = segs.flatMap((s) => devs(s));
  const moves = all.filter((d) => has(d.current_ip) && has(d.ip) && !same(d.current_ip, d.ip) && d.how !== "retire");
  if (moves.length) L.push("", "## Moves", "", ...head(["Device", "From", "To"]), ...moves.map((d) => row([devName(d), d.current_ip, d.ip])));
  const gone = all.filter((d) => d.how === "retire");
  if (gone.length) L.push("", "## Retiring", "", ...head(["Device", "Address now", "Role"]), ...gone.map((d) => row([devName(d), or(d.current_ip, or(d.ip, "-")), or(d.role, "")])));
  return L.join("\n");
}
