// Network Planner page. The plan lives in memory and in this browser's localStorage; nothing is sent
// anywhere. Every field of the plan format (schema 1) has an editor here.
import { check, carve, cidr, ip2n, n2ip, usable, firstHost, lastHost, reserved, summary, scopeOf, classOf, KINDS, HOWS } from "./ipplan.js";

const STORE = "netplanner.plan.v1";
const COLOUR_STORE = "netplanner.mapcolour";
const COLOURS = ["auto", "segment", "block"];
const HUES = 8;
const $ = (s) => document.querySelector(s);

let plan = load() || blank();
let sel = 0;          // selected segment index
let mapBase = null;   // first address of the /24 shown in the map
let pick = null;      // selected address in the map
let mapColour = loadColour(); // what the map's colours stand for: auto, segment or block

function blank() { return { schema: 1, name: "", address_space: [], notes: "", segments: [] }; }
// The editors need lists of objects. A plan with the wrong shape is refused rather than half-loaded;
// the message says what to fix. Returns null when the shape is fine.
function shapeProblem(p) {
  if (!p || typeof p !== "object" || Array.isArray(p)) return "The file isn't a plan (a JSON object).";
  if (p.address_space != null && !Array.isArray(p.address_space)) return '"address_space" must be a list.';
  const bad = check(p).find((f) => f.code === "bad-structure");
  return bad ? `${bad.where}: ${bad.message}` : null;
}
function load() {
  try { const s = localStorage.getItem(STORE); const p = s ? JSON.parse(s) : null; return p && !shapeProblem(p) ? p : null; } catch { return null; }
}
function save() { try { localStorage.setItem(STORE, JSON.stringify(plan)); } catch { /* private window: keep going */ } }
function loadColour() {
  try { const v = localStorage.getItem(COLOUR_STORE); return COLOURS.includes(v) ? v : "auto"; } catch { return "auto"; }
}

function h(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "value") e.value = v;
    else if (k === "checked") e.checked = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}

let toastT;
function toast(t) { const el = $("#toast"); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (el.hidden = true), 3500); }

function changed() { save(); render(); }
const segs = () => (Array.isArray(plan.segments) ? plan.segments : (plan.segments = []));
const hue = (i) => `var(--h${i % HUES})`;

// ---------- status and findings
function renderStatus(findings) {
  const err = findings.filter((f) => f.level === "error"), warn = findings.filter((f) => f.level === "warning");
  const devices = segs().reduce((n, s) => n + (s.devices || []).filter((d) => d.how !== "retire").length, 0);
  const st = (v, l, cls) => h("div", { class: "stat " + (cls || "") }, h("b", { text: v }), h("span", { text: l }));
  const list = findings.length
    ? h("ul", { class: "findings" }, findings.map((f) => h("li", { class: f.level }, h("span", { class: "where", text: f.where + ": " }), f.message)))
    : null;
  $("#status").replaceChildren(
    st(String(segs().length), segs().length === 1 ? "segment" : "segments"),
    st(String(devices), devices === 1 ? "device" : "devices"),
    st(String(err.length), "errors", err.length ? "bad" : "ok"),
    st(String(warn.length), "warnings", warn.length ? "warn" : ""),
    list || h("div", { class: "hint", text: segs().length ? "No problems found." : "Add a segment, size some with the tool below, or load the example." }),
  );
}

// ---------- address map: one /24 at a time
// The /24s the map can show. Segments come first, so a segment deep inside a /8 is always reachable;
// each range adds at most 64 /24s, and the address space only fills what's left of a 512 cap.
const WIN_PER_RANGE = 64, WIN_MAX = 512;
function windows() {
  const set = new Set();
  const add = (r, cap) => {
    let k = 0;
    for (let b = Math.floor(r.net / 256) * 256; b <= r.bcast && k < cap; b += 256, k++) set.add(b);
  };
  for (const s of segs()) { const c = cidr(s.cidr); if (c) add(c, WIN_PER_RANGE); }
  const space = Array.isArray(plan.address_space) ? plan.address_space : [];
  for (const r of space.map(cidr).filter(Boolean)) {
    if (set.size >= WIN_MAX) break;
    add(r, Math.min(WIN_PER_RANGE, WIN_MAX - set.size));
  }
  return [...set].sort((a, b) => a - b);
}
const firstWindowOf = (s) => { const c = cidr(s && s.cidr); return c ? Math.floor(c.net / 256) * 256 : null; };
function renderMap(findings) {
  const ws = windows();
  const selEl = $("#mapWindow");
  if (!ws.length) {
    selEl.replaceChildren(h("option", { text: "nothing yet" }));
    $("#map").replaceChildren(h("div", { class: "hint", text: "Add an address space or a segment to see its addresses." }));
    $("#legend").replaceChildren(); $("#pick").hidden = true;
    return;
  }
  if (mapBase == null || !ws.includes(mapBase)) { const w = firstWindowOf(segs()[sel]); mapBase = w != null && ws.includes(w) ? w : ws[0]; }
  selEl.replaceChildren(...ws.map((b) => h("option", { value: String(b), text: `${n2ip(b)}/24` })));
  selEl.value = String(mapBase);

  const parsed = segs().map((s, i) => ({ s, i, c: cidr(s.cidr) })).filter((x) => x.c);
  const occ = new Map();
  for (const { s, i } of parsed) for (const d of s.devices || []) {
    const n = ip2n(d.ip); if (n == null || d.how === "retire") continue;
    if (!occ.has(n)) occ.set(n, []); occ.get(n).push({ d, i });
  }
  const segAt = (n) => parsed.find((x) => n >= x.c.net && n <= x.c.bcast);
  const blockAt = (s, n) => (s.blocks || []).find((b) => ip2n(b.start) != null && ip2n(b.end) != null && n >= ip2n(b.start) && n <= ip2n(b.end));
  const inView = parsed.filter((x) => x.c.net < mapBase + 256 && x.c.bcast >= mapBase);
  // The blocks in view, in plan order. Spare blocks are grey (--h7); the others take the next of
  // the other seven hues, so no other block shares the spare grey.
  const shown = [];
  let k = 0;
  for (const x of inView) for (const b of x.s.blocks || []) {
    const lo = ip2n(b.start), hi = ip2n(b.end);
    if (lo == null || hi == null || lo > hi || lo >= mapBase + 256 || hi < mapBase) continue;
    shown.push({ b, x, lo, hi, colour: b.kind === "spare" ? `var(--h${HUES - 1})` : hue(k++ % (HUES - 1)) });
  }
  // Colour by block when asked, or in Auto when one segment fills the view and has blocks in it
  // (a flat network cut into blocks). A segment with no blocks keeps its segment colour and legend row.
  const byBlock = mapColour === "block" || (mapColour === "auto" && inView.length === 1 && shown.length > 0);
  const blockColour = new Map(shown.map((e) => [e.b, e.colour]));
  const cells = [];
  for (let n = mapBase; n < mapBase + 256; n++) {
    const sg = segAt(n), ds = occ.get(n) || [];
    const b = sg ? blockAt(sg.s, n) : null;
    // Network and broadcast addresses always show grey and hatched; a device planned on one gets the red clash outline.
    const netbc = !!sg && reserved(sg.c, n);
    const gw = !!sg && ip2n(sg.s.gateway) === n;
    const cls = ["cell", sg ? "" : "none", netbc ? "reserved" : "", !netbc && b && b.kind === "pool" ? "pool" : "", !netbc && ds.length ? "used" : "",
      ds.length > 1 || (netbc && ds.length) ? "clash" : "", gw ? "res" : "", pick === n ? "sel" : ""].join(" ");
    const what = netbc ? (n === sg.c.net ? "network address (reserved)" : "broadcast address (reserved)") : b ? b.name : "";
    const title = `${n2ip(n)}${sg ? ", " + (sg.s.name || sg.s.id) : ""}${what ? ", " + what : ""}${gw ? ", gateway" : ""}${ds.length ? ": " + ds.map((x) => x.d.name).join(" and ") : ""}`;
    const c = h("button", { type: "button", class: cls, title, "aria-label": title, onclick: () => { pick = pick === n ? null : n; renderMap(findings); } }, String(n % 256));
    // By block, an address in a segment but in no block keeps the neutral tint.
    const colour = !sg ? null : byBlock ? (b && blockColour.get(b)) || null : hue(sg.i);
    if (colour) c.style.setProperty("--c", colour);
    cells.push(c);
  }
  $("#map").replaceChildren(...cells);
  const legendRows = byBlock
    ? shown.map(({ b, x, lo, hi, colour }) => {
      const sw = h("span", { class: "sw" }); sw.style.setProperty("--c", colour);
      const used = (x.s.devices || []).filter((d) => { const n = ip2n(d.ip); return d.how !== "retire" && n != null && n >= lo && n <= hi; }).length;
      return h("div", { class: "lg" }, sw, h("span", { text: b.name || "unnamed" }), h("span", { class: "rng", text: `${b.start} - ${b.end}, ${b.kind || "fixed"}, ${used}/${hi - lo + 1} used` }));
    })
    : inView.map(({ s, i }) => {
      const sw = h("span", { class: "sw" }); sw.style.setProperty("--c", hue(i));
      return h("div", { class: "lg" }, sw, h("span", { text: s.name || s.id || "unnamed" }), h("span", { class: "rng", text: `${s.cidr}${s.vlan ? ", VLAN " + s.vlan : ""}${typeof s.shares_vlan_with === "string" ? " (shared with " + s.shares_vlan_with + ")" : ""}${s.site ? ", " + s.site : ""}` }));
    });
  const keyText = byBlock
    ? "Each colour is a block. Shaded: DHCP pool. Outlined: in use. Bold: gateway. Grey hatched: network or broadcast address, reserved. Light hatched: in no segment."
    : "Shaded: DHCP pool. Outlined: in use. Bold: gateway. Grey hatched: network or broadcast address, reserved. Light hatched: in no segment.";
  $("#legend").replaceChildren(...legendRows, h("div", { class: "hint", text: keyText }));
  const pk = $("#pick");
  if (pick == null || pick < mapBase || pick >= mapBase + 256) { pk.hidden = true; return; }
  const sg = segAt(pick), ds = occ.get(pick) || [];
  pk.hidden = false;
  pk.replaceChildren(
    h("div", { class: "ip", text: n2ip(pick) }),
    h("div", { class: "hint", text: sg ? `${sg.s.name || sg.s.id}${blockAt(sg.s, pick) ? ", " + blockAt(sg.s, pick).name : ""}${reserved(sg.c, pick) ? ", network or broadcast address" : ""}` : "In no segment" }),
    ...ds.map((x) => h("div", {}, h("b", { text: x.d.name }), x.d.role ? ", " + x.d.role : "")),
  );
}

// ---------- editors
function field(obj, key, opts = {}) {
  const v = obj[key];
  return h("input", {
    class: opts.mono ? "mono" : "", value: v == null ? "" : String(v), placeholder: opts.ph || "", "aria-label": opts.label || key,
    size: String(opts.size || (opts.mono ? 17 : 14)), list: opts.list,
    onchange: (e) => {
      const raw = e.target.value.trim();
      if (raw === "") delete obj[key];
      else if (opts.number) { const n = Number(raw); obj[key] = Number.isFinite(n) ? n : raw; }
      else obj[key] = raw;
      changed();
    },
  });
}
function pickList(obj, key, options, label, fallback) {
  const s = h("select", { "aria-label": label, onchange: (e) => { obj[key] = e.target.value; changed(); } }, options.map((o) => h("option", { value: o, text: o })));
  s.value = options.includes(obj[key]) ? obj[key] : fallback;
  return s;
}
function delBtn(label, onConfirm) {
  const b = h("button", { type: "button", class: "del", "aria-label": "Delete " + label, text: "Delete" });
  b.addEventListener("click", () => {
    if (!b.classList.contains("arm")) { b.classList.add("arm"); b.textContent = "Confirm"; setTimeout(() => { b.classList.remove("arm"); b.textContent = "Delete"; }, 3000); return; }
    onConfirm(); changed();
  });
  return b;
}
const issuesFor = (findings, prefix) => findings.filter((f) => f.where === prefix || f.where.startsWith(prefix + ","));
const issueCell = (list) => h("td", { class: "iss" + (list.length && list.every((f) => f.level === "warning") ? " warn" : "") }, list.map((f) => f.message).join(" ") || h("span", { class: "hint", text: "ok" }));

function renderSegments(findings) {
  const head = h("tr", {}, ["", "Id", "Name", "Site", "VLAN", "Shares VLAN", "Range", "Gateway", "Usable", "Purpose", "Check", ""].map((t) => h("th", { text: t })));
  const rows = segs().map((s, i) => {
    const c = cidr(s.cidr);
    const sw = h("span", { class: "sw" }); sw.style.setProperty("--c", hue(i));
    const label = `segment ${s.id ?? "#" + (i + 1)}`;
    const own = findings.filter((f) => f.where === label);
    return h("tr", { class: i === sel ? "current" : "" },
      h("td", {}, h("button", { type: "button", class: "btn small", onclick: () => { sel = i; const w = firstWindowOf(s); if (w != null) { mapBase = w; pick = null; } render(); } }, sw, " Edit")),
      h("td", {}, field(s, "id", { label: "Segment id", ph: "users", size: 9 })),
      h("td", {}, field(s, "name", { label: "Segment name", ph: "Staff" })),
      h("td", {}, field(s, "site", { label: "Site", ph: "optional", size: 12 })),
      h("td", {}, field(s, "vlan", { label: "VLAN", number: true, ph: "30", size: 5 })),
      h("td", {}, field(s, "shares_vlan_with", { label: "Shares VLAN with", ph: "segment id", size: 10 })),
      h("td", {}, field(s, "cidr", { label: "Range", mono: true, ph: "192.0.2.0/26" })),
      h("td", {}, field(s, "gateway", { label: "Gateway", mono: true, ph: c ? n2ip(firstHost(c)) : "" })),
      h("td", { class: "rng", text: c ? String(usable(c)) : "-" }),
      h("td", { class: "w-wide" }, field(s, "purpose", { label: "Purpose", ph: "Who lives here, what it may reach", size: 32 })),
      issueCell(own),
      h("td", {}, delBtn(label, () => { segs().splice(i, 1); sel = Math.max(0, Math.min(sel, segs().length - 1)); })),
    );
  });
  $("#segTable").replaceChildren(h("thead", {}, head), h("tbody", {}, rows.length ? rows : h("tr", {}, h("td", { colspan: "12", class: "hint", text: "No segments yet." }))));
}

function renderDetail(findings) {
  const s = segs()[sel];
  const box = $("#segDetail");
  if (!s) { box.replaceChildren(); return; }
  s.blocks = s.blocks || []; s.devices = s.devices || [];
  const label = `segment ${s.id ?? "#" + (sel + 1)}`;
  const c = cidr(s.cidr);
  const bHead = h("tr", {}, ["Block", "Start", "End", "Kind", "Size", "Note", "Check", ""].map((t) => h("th", { text: t })));
  const bRows = s.blocks.map((b, j) => {
    const lo = ip2n(b.start), hi = ip2n(b.end);
    return h("tr", {},
      h("td", {}, field(b, "name", { label: "Block name" })),
      h("td", {}, field(b, "start", { label: "Start", mono: true })),
      h("td", {}, field(b, "end", { label: "End", mono: true })),
      h("td", {}, pickList(b, "kind", KINDS, "Kind", "fixed")),
      h("td", { class: "rng", text: lo != null && hi != null && hi >= lo ? String(hi - lo + 1) : "-" }),
      h("td", { class: "w-wide" }, field(b, "note", { label: "Note", size: 24 })),
      issueCell(issuesFor(findings, `${label}, block ${b.name ?? "unnamed"}`)),
      h("td", {}, delBtn("block", () => s.blocks.splice(j, 1))),
    );
  });
  const dHead = h("tr", {}, ["Device", "Address", "Now at", "How", "Gateway", "Role", "Runs on", "Note", "Check", ""].map((t) => h("th", { text: t })));
  // Suggestions for "Runs on": every device name in the plan, retiring ones too. Focusing a row's
  // field drops that row's own name from the list, since a device can't run on itself.
  const names = [...new Set(segs().flatMap((x) => (Array.isArray(x.devices) ? x.devices : [])).map((d) => d && d.name).filter((n) => typeof n === "string" && n !== ""))];
  const nameList = h("datalist", { id: "deviceNames" });
  const suggest = (self) => nameList.replaceChildren(...names.filter((n) => n !== self).map((n) => h("option", { value: n })));
  suggest(null);
  const runsOnField = (d) => {
    const f = field(d, "runs_on", { label: "Runs on", ph: "device name", size: 12, list: "deviceNames" });
    f.addEventListener("focus", () => suggest(d.name));
    return f;
  };
  const dRows = s.devices.map((d, j) => h("tr", {},
    h("td", {}, field(d, "name", { label: "Device name" })),
    h("td", {}, field(d, "ip", { label: "Planned address", mono: true, ph: d.how === "dynamic" ? "from the pool" : "" })),
    h("td", {}, field(d, "current_ip", { label: "Address today", mono: true })),
    h("td", {}, pickList(d, "how", HOWS, "How", "reserved")),
    h("td", {}, h("input", { type: "checkbox", "aria-label": "Is the gateway", checked: d.gateway === true, onchange: (e) => { if (e.target.checked) d.gateway = true; else delete d.gateway; changed(); } })),
    h("td", {}, field(d, "role", { label: "Role", size: 20 })),
    h("td", {}, runsOnField(d)),
    h("td", { class: "w-wide" }, field(d, "note", { label: "Note", size: 24 })),
    issueCell(issuesFor(findings, `${label}, device ${d.name ?? "unnamed"}`)),
    h("td", {}, delBtn("device", () => s.devices.splice(j, 1))),
  ));
  const addBlock = () => {
    const kinds = s.blocks.map((b) => ip2n(b.end)).filter((n) => n != null);
    const start = c ? (kinds.length ? Math.max(...kinds) + 1 : firstHost(c)) : null;
    s.blocks.push(start != null && c && start <= lastHost(c) ? { name: "New block", start: n2ip(start), end: n2ip(Math.min(lastHost(c), start + 7)), kind: "fixed" } : { name: "New block", start: "", end: "", kind: "fixed" });
    changed();
  };
  box.replaceChildren(
    h("div", { class: "sechead" }, h("h2", { text: `${s.name || s.id || "Segment"}${s.cidr ? " (" + s.cidr + ")" : ""}` }),
      h("span", { class: "hint", text: c ? `First usable ${n2ip(firstHost(c))}, last usable ${n2ip(lastHost(c))}. ${scopeOf(c)[0].toUpperCase() + scopeOf(c).slice(1)}, old-style class ${classOf(c.net)}.` : "Set a range to see its addresses." })),
    h("div", { class: "detailgrid" },
      h("div", { class: "sechead" }, h("h3", { text: "Blocks" }), h("button", { type: "button", class: "btn", onclick: addBlock }, "Add block")),
      h("div", { class: "scroll" }, h("table", {}, h("thead", {}, bHead), h("tbody", {}, bRows.length ? bRows : h("tr", {}, h("td", { colspan: "8", class: "hint", text: "No blocks. Split the range into fixed, pool and spare blocks." }))))),
      h("div", { class: "sechead" }, h("h3", { text: "Devices" }), h("button", { type: "button", class: "btn", onclick: () => { s.devices.push({ name: "new device", how: "reserved" }); changed(); } }, "Add device")),
      h("div", { class: "scroll" }, h("table", {}, h("thead", {}, dHead), h("tbody", {}, dRows.length ? dRows : h("tr", {}, h("td", { colspan: "10", class: "hint", text: "No devices yet." }))))),
    ),
    nameList,
  );
}

function render() {
  const findings = check(plan);
  const a = document.activeElement;
  $("#planName").value = plan.name || "";
  if (a !== $("#space")) $("#space").value = (plan.address_space || []).join("\n");
  if (a !== $("#notes")) $("#notes").value = plan.notes || "";
  renderStatus(findings); renderMap(findings); renderSegments(findings); renderDetail(findings);
}

// ---------- top-level controls
function download(name, type, text) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = h("a", { href: url, download: name }); document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const fileBase = () => (plan.name || "network-plan").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "network-plan";

$("#planName").addEventListener("change", (e) => { plan.name = e.target.value.trim(); changed(); });
$("#space").addEventListener("change", (e) => { plan.address_space = e.target.value.split(/[\s,]+/).filter(Boolean); changed(); });
$("#notes").addEventListener("change", (e) => { if (e.target.value.trim()) plan.notes = e.target.value; else delete plan.notes; changed(); });
$("#mapWindow").addEventListener("change", (e) => { mapBase = Number(e.target.value); pick = null; render(); });
$("#mapColour").value = mapColour;
$("#mapColour").addEventListener("change", (e) => {
  mapColour = COLOURS.includes(e.target.value) ? e.target.value : "auto";
  try { localStorage.setItem(COLOUR_STORE, mapColour); } catch { /* private window: keep going */ }
  renderMap(check(plan));
});
$("#btnNew").addEventListener("click", () => {
  if (segs().length && !confirmArm($("#btnNew"))) return;
  plan = blank(); sel = 0; mapBase = null; changed();
});
$("#btnExample").addEventListener("click", async () => {
  if (segs().length && !confirmArm($("#btnExample"))) return;
  const name = $("#exampleSel").value;
  try {
    plan = await (await fetch(`examples/${encodeURIComponent(name)}.json`)).json();
    sel = 0; mapBase = null; pick = null; changed();
    toast(`Loaded the ${$("#exampleSel").selectedOptions[0].text.toLowerCase()} example.`);
  } catch { toast("Couldn't load that example."); }
});
$("#fileImport").addEventListener("change", async (e) => {
  const f = e.target.files[0]; e.target.value = "";
  if (!f) return;
  let p;
  try { p = JSON.parse(await f.text()); } catch { toast(`${f.name} isn't valid JSON.`); return; }
  const problem = shapeProblem(p);
  if (problem) { toast(`Can't load ${f.name}. ${problem}`); return; }
  plan = p; sel = 0; mapBase = null; changed(); toast(`Loaded ${f.name}.`);
});
$("#btnExportJson").addEventListener("click", () => download(fileBase() + ".json", "application/json", JSON.stringify(plan, null, 2) + "\n"));
$("#btnExportMd").addEventListener("click", () => download(fileBase() + ".md", "text/markdown", summary(plan) + "\n"));
$("#btnAddSeg").addEventListener("click", () => { segs().push({ id: `seg${segs().length + 1}`, name: "New segment", blocks: [], devices: [] }); sel = segs().length - 1; changed(); });

// Replacing a plan that has work in it takes a second click.
function confirmArm(btn) {
  if (btn.dataset.arm) { delete btn.dataset.arm; btn.classList.remove("primary"); return true; }
  btn.dataset.arm = "1"; btn.classList.add("primary"); toast("This replaces the current plan. Click again to confirm, or export it first.");
  setTimeout(() => { delete btn.dataset.arm; btn.classList.remove("primary"); }, 4000);
  return false;
}

$("#btnCarve").addEventListener("click", () => {
  const parent = $("#carveParent").value.trim();
  const lines = $("#carveReqs").value.split("\n").map((l) => l.trim()).filter(Boolean);
  const reqs = [];
  for (const l of lines) {
    const m = /^([A-Za-z0-9._-]+)\s*:\s*([0-9]+)$/.exec(l);
    if (!m) { toast(`Write each line as name:hosts (got "${l}").`); return; }
    reqs.push({ name: m[1], hosts: Number(m[2]) });
  }
  if (!parent || !reqs.length) { toast("Give a parent range and at least one name:hosts line."); return; }
  const avoid = $("#carveAvoid").checked ? segs().map((s) => s.cidr).filter((x) => typeof x === "string") : [];
  const r = carve(parent, reqs, avoid);
  const out = $("#carveOut");
  if (!r.ok) { out.replaceChildren(h("div", { class: "iss", text: r.error })); return; }
  out.replaceChildren(
    h("div", { class: "scroll" }, h("table", {},
      h("thead", {}, h("tr", {}, ["Segment", "Range", "Gateway", "Usable", "Asked for"].map((t) => h("th", { text: t })))),
      h("tbody", {}, r.segments.map((s) => h("tr", {}, [s.name, s.cidr, s.gateway, s.usable, s.hosts_asked].map((v) => h("td", { class: "rng", text: String(v) }))))))),
    h("p", { class: "hint", text: `${r.free} addresses left free in ${r.parent}.` }),
    h("button", { type: "button", class: "btn primary", onclick: () => {
      const ids = new Set(segs().map((s) => s.id));
      for (const s of r.segments) {
        let id = s.id, k = 2; while (ids.has(id)) id = `${s.id}-${k++}`; ids.add(id);
        segs().push({ id, name: s.name, cidr: s.cidr, gateway: s.gateway, blocks: [], devices: [] });
      }
      if (!(plan.address_space || []).length) plan.address_space = [r.parent];
      out.replaceChildren(); changed(); toast(`Added ${r.segments.length} segment(s).`);
    } }, "Add these to the plan"),
  );
});

render();
