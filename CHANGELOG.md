# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] - 2026-11-26

**Upgrading:** nothing to do. A plan with two segments on one VLAN at the same site used to fail the check, and now it passes with a warning. Add `shares_vlan_with` to mark the shared VLAN as deliberate and clear the warning.

### Added

- Segments take an optional `shares_vlan_with`: the id of another segment whose VLAN this one shares on purpose, such as a secondary subnet on one router interface, or old and new subnets side by side during a re-IP. `ipplan check` reports `bad-vlan-share` when it names the segment itself, a segment that isn't in the plan, or one at another site or on a different VLAN.
- `ipplan summary` and the web planner show the shared VLAN. The summary's VLAN column reads, for example, "30 (shared with clients)". The page has a Shares VLAN column in the segments table, and when the address map colours by segment, its legend shows the share too.
- The home lab example now shows a re-IP in progress. The old router's network runs on the clients VLAN until the desktop and the BMC have moved off it.
- Devices take an optional `runs_on`: the name of the device this one runs on, such as the hypervisor under a VM or container. `ipplan check` reports `bad-runs-on` when it isn't a string or names the device itself, and warns with `runs-on-missing` when no device in the plan has that name. A retiring device still counts. When any device has `runs_on`, `ipplan summary` adds a Runs on column to each segment's device table. The web planner's devices table has a Runs on column too, and it suggests the names of the plan's devices as you type.
- The web planner's address map can colour by block. A Colour by menu next to the map's Showing menu offers Auto, Segment and Block, and the page remembers your choice. Auto colours by block when exactly one segment overlaps the /24 on show and some of its blocks fall inside it. Otherwise it colours by segment. In block mode, each block gets its own colour, only spare blocks are grey, and the legend lists every block on show with its range, its kind and how many of its addresses are in use.
- A flat home lab example: one /24 with no VLANs, cut into blocks for network gear, hypervisors, VMs and containers, the DHCP pool and printers. Each VM and container names its hypervisor in `runs_on`. It's in the web planner's example list as Flat home lab. The skill now says when one flat network is enough, and `references/segment-patterns.md` shows how to lay one out.

### Changed

- `duplicate-vlan` is now a warning. A plan whose only problem is a repeated VLAN makes `ipplan check` exit 2 instead of 1, and `ipplan check --json` and `/api/check` now report `"ok": true` for it. The warning only appears when more than one segment on that VLAN lacks a valid `shares_vlan_with`, and the message now says how to mark the share.

### Fixed

- `ipplan check` and the web planner used to disagree on a few malformed plans, and now give the same findings: a VLAN written as `30.0` or `3e1`, a `site` written as an object, and an `id`, block `kind` or device `how` set to `false`. The Markdown export from `ipplan summary` and from the page matches for these plans too.
- `ipplan summary` used to stop with a jq error when a segment's `blocks` or `devices` wasn't a list of objects, when a block's start or end wasn't an IPv4 address, or when `address_space` wasn't a list. It also listed the entries of a `segments` object as segments. Now it skips what it can't read, as the page's Markdown export does, and the two print the same text for these plans. Both also treat an empty string as missing, so a plan saved from the page without a name gets the heading "Network plan" from either one.

## [1.0.1] - 2026-11-25

**Upgrading:** nothing to do.

### Fixed

- The web planner's privacy page now says that Cloudflare Web Analytics runs on the hosted site: it counts visits and page load times without cookies, and never sees your plan. The page used to say no outside scripts loaded.

## [1.0.0] - 2026-11-25

**Upgrading:** first release, so there's nothing to upgrade. Copy `skills/network-planner/` into your skills folder, or install the repo as a Claude Code plugin.

### Added

- The `network-planner` skill, for Claude Code and any other agent that reads `SKILL.md` folders. It guides someone through planning a network one topic at a time, writes the plan, and checks it with the bundled `ipplan` helper until it's clean. Agents that can't run scripts follow the same method by hand and say the plan is unchecked.
- A plan file format (schema 1) for IPv4 networks. A plan lists the address space, its segments with VLAN, range, gateway and purpose, the fixed, pool and spare blocks inside each segment, and the devices with their planned and current addresses. A JSON Schema is included.
- `ipplan check` finds mistakes before anything gets configured: overlapping or misaligned segments, segments outside the address space, repeated VLANs, a gateway in the wrong place, overlapping blocks, devices on a network or broadcast address, duplicate addresses, and fixed addresses inside a DHCP pool. A file with lists in the wrong shape gets a `bad-structure` error. It exits 1 on errors and 2 on warnings, and `--json` prints results for other tools.
- `ipplan carve` sizes segments from host counts and places them, biggest first, on proper boundaries inside a parent range. `--plan` and `--avoid` keep new segments clear of ranges already in use.
- `ipplan summary` prints a plan as Markdown tables, with a list of devices that have to move. `ipplan info` describes a single range, including what kind of space it's in and its old-style class (A to E), which Network+ still teaches but routing ignores.
- `ipplan check` flags ranges devices can't use (multicast, reserved, loopback, link-local, "this network") as errors, and warns about the carrier-grade NAT range and public address space.
- Five example plans: a small office, a home, a home lab, AV and building systems, and three sites that reuse the same VLAN numbers. Segments take an optional `site`, and VLAN numbers only have to be unique within a site.
- A web planner at netplanner.rpaprocki.com. You can lay out segments, size them, fill in blocks and devices, and see the problems as you type. There's an address map for any range, one /24 at a time. It imports and exports the same plan file, keeps your work in your own browser, and has an Auto, Light or Dark theme choice that it remembers.
- An API on the same site: `/api/check`, `/api/carve` and `/api/info`. Plans are checked in memory and never stored or logged.
- A JavaScript version of the checker for the site. It runs the same shared test cases as `ipplan` and has to give the same findings, word for word.
- A Microsoft 365 Copilot agent package. `copilot/build.sh` builds a zip you can upload to Microsoft 365. It carries the same skill, plus instructions to do the subnet math with Code Interpreter, and checks Microsoft's documented manifest limits before writing anything.
- IPv4 only for now: IPv6 ranges and addresses come back as errors.
- Released under the MIT License.
