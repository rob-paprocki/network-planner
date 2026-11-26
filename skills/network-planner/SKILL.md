---
name: network-planner
description: Plan an IPv4 network with someone, from a blank sheet or an existing mess. Walks them through the address space, segments and VLANs, address blocks (fixed, DHCP pool, spare) and devices; writes the plan as a JSON file; sizes subnets and checks the plan with the bundled ipplan tool so overlaps, bad boundaries and pool clashes get caught before anything is configured. Use it whenever someone wants to design, redesign, split, re-IP, document or hand off a LAN, home lab, office or site network, asks how to carve a range into subnets or VLANs, wants to know what size subnet they need, or shares a list of devices and IPs to organise, even if they never say "plan".
license: MIT
compatibility: The bundled helper needs bash 3.2 or later and jq 1.6 or later. Without a shell the skill still works, unchecked. IPv4 only for now.
---

# Network planner

You help someone turn "we need some VLANs" into a plan they can build from: every segment with its range, gateway and purpose, every block of addresses with its job, and every device with its address. The plan lives in one JSON file. The bundled `ipplan` tool does the arithmetic and the checking, because subnet mistakes made in your head look correct on the page: a /26 that starts on .40 reads fine and breaks a switch config.

`ipplan` is at `scripts/ipplan` inside this skill's folder (the base directory shown when the skill loads). Call it by that full path.

| Command | What it does |
|---|---|
| `ipplan carve PARENT name:hosts ... [--plan plan.json] [--avoid CIDR] [--json]` | Sizes each segment from a host count (it adds the gateway, network and broadcast addresses), then places them biggest first on proper boundaries. `--plan` keeps it clear of segments already in a plan |
| `ipplan check plan.json [--json]` | Finds mistakes. Exit 0 means clean, 1 means errors, 2 means warnings only |
| `ipplan summary plan.json` | The whole plan as Markdown tables, for handing off |
| `ipplan info CIDR` | One range's mask, usable count, first and last address, what kind of space it is (private, documentation, multicast, public) and its old-style class |

The file format is in `references/plan-format.md`, and `examples/` holds six complete, clean plans to copy from: `small-office.json`, `home.json`, `home-lab.json` (part way through a re-IP, with the old network sharing a VLAN), `flat-lab.json` (one /24 with no VLANs, cut into blocks, where each VM names its hypervisor in `runs_on`), `av-building.json` and `three-sites.json` (several sites that reuse VLAN numbers, with `site` set on each segment and /31 links between them). Pick the one closest to what the person describes. For advice on which segments to have, how big to make them and how to number VLANs, read `references/segment-patterns.md` when you reach that step.

### If you can't run the helper

Some agents can't run scripts (no shell, or no jq). The method below still applies, so keep going, but do the arithmetic slowly and show it:

- A segment of size N (a power of two) has to start on a multiple of N. Work from the prefix table in `references/segment-patterns.md`, and lay segments out biggest first, so each one lands on its boundary.
- Write out each segment's network, first usable, last usable and broadcast address. Then check the blocks and devices against those four numbers one at a time.
- Go through the error list in `references/plan-format.md` by hand.
- Tell the person plainly that the plan hasn't been machine-checked, and suggest they run `scripts/ipplan check` on it, or have someone else do it, before building.

## How a session goes

Work through these in order, but don't interrogate. Ask about one topic at a time, offer a sensible default with each question, and let people say "you pick". Many of them know their devices well and the theory less well. Explain a term the first time you use it (a one-line gloss of "VLAN" or "DHCP pool" is enough).

### 1. Where they're starting from

Find out whether this is a new network or an existing one being reorganised, and where the plan file should live (default: `network-plan.json` in the current folder). If they already have a plan file, run `ipplan check` on it first and start from what it says.

For an existing network, ask for what they have: a router's DHCP lease list, a spreadsheet, an `arp -a` dump, a list from memory. Put each device's address today in `current_ip`. That lets the summary show what has to move, and the person can plan the cut-over.

### 2. Address space

Pick the parent range everything fits inside, and record it in `address_space`. Ask what it has to avoid: ranges used by a VPN they connect to, other sites, a parent company or the ISP's equipment. Clashing with a VPN range is the most common reason a "working" plan fails later. If several sites are involved, give each site its own block of the space first, then carve segments inside each site's block. Set `site` on every segment; sites can then reuse the same VLAN numbers, and the check only flags a repeat within one site.

### 3. Segments

A segment is one subnet with one purpose and, usually, one VLAN. Group devices by who they belong to and what they're allowed to reach, not by device type. `references/segment-patterns.md` has starting sets for a home, a home lab, a small office and an AV or building-systems network.

A flat network is a single segment, often with no VLAN, cut into blocks in step 4. It's fine for a home or small lab where the devices don't need to be kept apart, and `references/segment-patterns.md` has a layout for one.

For each segment, get a short `id`, a name, a VLAN number, a host count and a sentence of purpose saying what it may and may not reach. That sentence becomes the firewall rules later, so it's worth getting. Size for growth: a count of what's there today plus about half again, or double for anything with DHCP clients. Then run:

```bash
<skill-dir>/scripts/ipplan carve <PARENT> users:120 voice:40 cameras:24 mgmt:12
```

Use the ranges it gives you. Don't compute them yourself. When adding to an existing plan, pass `--plan <file>` so new segments land in free space.

One VLAN usually carries one subnet. Two subnets on one VLAN make sense in two cases: a re-IP, where the old and new subnets run side by side until every device has moved, or a secondary subnet added to a router interface whose first range has filled up. Tell the person what it costs. There's no layer-2 separation between those subnets, so they're one broadcast domain and a device on one can talk to the other directly, without passing the router's firewall. The DHCP server also needs a scope for each subnet on that VLAN. If they still want it, give each subnet its own segment with the same `vlan` and `site`, and set `shares_vlan_with` on all of them except one, naming another segment on that VLAN. Without it, `check` warns that the VLAN repeats.

### 4. Blocks inside each segment

Split each segment into blocks: `fixed` for addresses set by hand or by DHCP reservation, `pool` for what DHCP hands out, `spare` for room to grow. A layout that suits most segments: gateway first, fixed devices low, the pool in the upper part, and a spare gap between them so either side can grow. Keep blocks inside the first and last usable address (`ipplan info` shows them).

### 5. Devices

List each device with its planned `ip` and `how`:

- `static`: set on the device itself.
- `reserved`: a DHCP reservation.
- `dynamic`: any address from the pool. No `ip` needed.
- `retire`: being removed.

For a VM or container, set `runs_on` to the name of the device it runs on, usually a hypervisor, and list that host as a device too. The summary then shows each guest's host, and `check` warns when `runs_on` names a device that isn't in the plan.

Fixed and reserved devices go in fixed blocks, never in the pool, because DHCP would hand the same address to something else. Listing the gateway interface as a device is optional. If you do, mark it `"gateway": true`; the summary leaves it out of the device count. Segment order in the plan doesn't matter: `carve` puts the biggest segments first so each lands on its boundary.

### 6. Write, check, fix, repeat

Write the JSON file, then run `ipplan check` on it. Fix every error. Talk each warning through with the person, since some are deliberate (a device in a spare block on purpose), and keep the ones they agree to. Run the check again after every edit. Don't present a plan as done until the check exits 0, or exits 2 with every warning agreed.

### 7. Hand it off

Run `ipplan summary` and show the result, or save it beside the plan (`network-plan.md`) if they want something to send on. Finish with what has to be configured to build it, in a short list: VLANs on switches and access points, gateway interfaces, DHCP scopes and reservations, firewall rules between segments (from each segment's purpose), and the moves from `current_ip`, in an order that won't cut off the person doing the work. Move the management network last.

## Things to get right

- A segment's range has to start on a multiple of its size. `check` reports a misaligned one and suggests the fix.
- Point-to-point links (/31) and single hosts (/32) have no network or broadcast address, so every address in them is usable. `ipplan` knows this; don't flag them yourself.
- In segments bigger than a /24, addresses ending in .0 or .255 are legal, but some devices refuse them. `check` warns about them, and the easy fix is to leave them out of blocks.
- Devices can't use multicast (224.0.0.0/4), the reserved block (240.0.0.0/4), loopback, link-local or 0.0.0.0/8, so `check` rejects segments there. It also warns about the carrier-grade NAT range (100.64.0.0/10) and about public address space, which is only right if the organisation owns it.
- This version plans IPv4 only, and the checker rejects IPv6. If they need IPv6 too, plan IPv4 here and tell them plainly that IPv6 needs its own plan.
- The plan file is the source of truth. When something changes, edit it, check it again and send a fresh summary.
