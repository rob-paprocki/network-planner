# Plan file format (schema 1)

One JSON file per network. `schema/plan.schema.json` is the formal schema, which editors can use for autocomplete. `ipplan check` enforces the rules a schema can't express: overlaps, boundaries, pools and duplicates.

```json
{
  "schema": 1,
  "name": "Example small office",
  "address_space": ["192.168.100.0/24"],
  "notes": "Free text: decisions, open questions.",
  "segments": [
    {
      "id": "users", "name": "Staff", "vlan": 30,
      "cidr": "192.168.100.64/26", "gateway": "192.168.100.65",
      "purpose": "Staff laptops and phones. Internet and the servers segment only.",
      "blocks": [
        { "name": "Fixed", "start": "192.168.100.65", "end": "192.168.100.79", "kind": "fixed" },
        { "name": "DHCP",  "start": "192.168.100.80", "end": "192.168.100.126", "kind": "pool" }
      ],
      "devices": [
        { "name": "reception-pc", "ip": "192.168.100.66", "how": "reserved", "role": "Front desk PC",
          "current_ip": "192.168.100.90" },
        { "name": "staff-laptops", "how": "dynamic", "role": "Any staff laptop" }
      ]
    }
  ]
}
```

## Top level

| Field | Required | Meaning |
|---|---|---|
| `schema` | yes | Always `1` |
| `name` | no | What the plan is for |
| `address_space` | no | List of ranges every segment must fit inside. Leave it out to skip that check |
| `notes` | no | Free text |
| `segments` | yes | List of segments |

## Segment

| Field | Required | Meaning |
|---|---|---|
| `id` | yes | Short unique key: letters, digits, `.`, `_` or `-` |
| `name` | yes | What people call it |
| `cidr` | yes | The range, on its own boundary (`192.168.100.64/26`, not `.70/26`) |
| `site` | no | Which site the segment belongs to. Use it when sites reuse the same VLAN numbers |
| `vlan` | no | 1 to 4094, unique within its site (or across the plan when segments have no site) |
| `gateway` | no, but warned | The router address on this segment, usually the first usable address |
| `purpose` | no | Who lives here and what they may reach |
| `blocks` | no | Runs of addresses with a job |
| `devices` | no | What gets an address |

## Block

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | What the block is for |
| `start`, `end` | yes | First and last address, inclusive |
| `kind` | yes | `fixed` (set by hand or reserved), `pool` (handed out by DHCP) or `spare` (held for later) |
| `note` | no | Free text |

Blocks in a segment may not overlap. Leave gaps between them if you like: an address in no block only gets a warning when a device sits on it.

## Device

| Field | Required | Meaning |
|---|---|---|
| `name` | yes | Host name or label |
| `how` | yes | `static`, `reserved`, `dynamic` or `retire` |
| `ip` | unless dynamic or retire | The planned address |
| `current_ip` | no | Where it is today, if it moves |
| `gateway` | no | `true` for the device that is the segment's gateway |
| `role`, `note` | no | Free text |

## What `ipplan check` reports

Errors (exit 1) mean the plan can't be built as written. Warnings (exit 2) mean it can, but someone should decide.

| Code | Level | Meaning |
|---|---|---|
| `schema`, `no-segments`, `not-an-object` | error | The file isn't a plan yet |
| `bad-structure` | error | `segments`, `blocks` or `devices` isn't a list of objects |
| `missing-id`, `missing-cidr`, `missing-name` | error / warning | A required field is missing |
| `bad-cidr`, `bad-address` | error | Not a valid IPv4 range or address |
| `ipv6-unsupported` | error | IPv6 isn't supported yet |
| `misaligned-cidr` | error | The range doesn't start on its boundary. The message gives the right one |
| `outside-space` | error | A segment falls outside `address_space` |
| `special-range` | error | A range overlaps multicast, the reserved block, loopback, link-local or "this network", which devices can't use |
| `cgnat-range` | warning | A segment is in the carrier-grade NAT range `100.64.0.0/10` |
| `public-range` | warning | A segment is public address space: outside the private ranges and the documentation ranges |
| `segment-overlap` | error | Two segments share addresses |
| `duplicate-id`, `duplicate-vlan` | error | Two segments share an id, or two segments at one site share a VLAN |
| `vlan-range` | error | VLAN outside 1 to 4094 |
| `no-gateway` | warning | No gateway set |
| `gateway-outside`, `gateway-reserved`, `gateway-in-pool` | error | The gateway is outside the segment, on its network or broadcast address, or inside the DHCP pool |
| `block-kind`, `block-order`, `block-outside`, `block-overlap` | error | Bad kind, start after end, outside the segment, or blocks overlapping |
| `block-reserved` | warning | A block includes the network or broadcast address |
| `no-pool` | error | Dynamic devices but no pool block |
| `device-how`, `needs-address` | error | Bad `how`, or a fixed device with no `ip` |
| `device-outside`, `device-reserved` | error | Address outside the segment, or its network or broadcast address |
| `device-on-gateway` | error | A device sits on the gateway address without `"gateway": true` |
| `gateway-mismatch` | warning | Marked as the gateway but not on the gateway address |
| `duplicate-address` | error | Two live devices planned on one address (retiring devices don't count) |
| `fixed-in-pool` | error | A static or reserved address inside the DHCP pool |
| `dynamic-outside-pool`, `in-spare`, `no-block` | warning | A device sits where its `how` doesn't fit |
| `edge-octet` | warning | An address ending in .0 or .255 inside a segment bigger than a /24 |

`ipplan check --json` prints `{plan, ok, findings: [{level, where, code, message}]}` for tools to read.
