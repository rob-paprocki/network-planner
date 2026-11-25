# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
