# Segment patterns and sizing

These are starting points. Change them to fit the place.

## Picking the address space

Private networks use the three RFC 1918 ranges: 10.0.0.0/8, 172.16.0.0/12 (172.16 to 172.31) and 192.168.0.0/16.

- A home or small office fits in one /24 or a /23 from 192.168.0.0/16. Skip 192.168.0.0/24 and 192.168.1.0/24, the ranges consumer routers ship with, if anyone will VPN in from home, because the two will clash.
- A business with several sites usually takes a big block from 10.0.0.0/8 and gives each site an equal, aligned share (a /16 or a /20 each) so routes summarise cleanly, then carves segments inside each one.
- Ask about VPNs and partners before choosing. Any range they already use is the one to avoid.

## Sizing a segment

1. Count what's there today, including the printers, cameras and badge readers that people forget.
2. Add growth: about half again for fixed devices, and double for DHCP clients, since phones and guests come and go.
3. Give `ipplan carve` the result. It adds the gateway, network and broadcast addresses and rounds up to the next block size.

| Prefix | Addresses | Usable |
|---|---|---|
| /30 | 4 | 2 |
| /29 | 8 | 6 |
| /28 | 16 | 14 |
| /27 | 32 | 30 |
| /26 | 64 | 62 |
| /25 | 128 | 126 |
| /24 | 256 | 254 |
| /23 | 512 | 510 |
| /22 | 1024 | 1022 |
| /21 | 2048 | 2046 |
| /20 | 4096 | 4094 |

Bigger than a /23 is rarely right for one segment. A broadcast domain that large gets noisy, and so does troubleshooting it. Split by purpose instead.

## VLAN numbering

Pick a scheme people can remember, and write it in the plan's `notes`:

- Number by tens: 10 management, 20 servers, 30 staff, 40 guest, 50 cameras, 60 voice, 70 building systems. That leaves room for a 31 or 32 later.
- Or match the address: VLAN 30 uses the range whose third number is 30. It's easy to read at a glance, but only works when segments are /24s.
- Keep VLAN 1 out of the plan. It's the default on most switches, so a misconfigured port lands there.

## Several subnets on one VLAN

Plan one subnet per VLAN unless one of these applies:

- A re-IP. The old and new subnets run on one VLAN while devices move across one at a time, and the old subnet is removed once it's empty. Either one can join the other's VLAN. `examples/home-lab.json` shows one part way through, with the old flat network on the new clients VLAN.
- A secondary subnet. The router interface gets a second address and range because the first range filled up and renumbering can wait.

The subnets on that VLAN are one broadcast domain. Nothing at layer 2 keeps them apart, so a device on one can reach the other without going through the router, and firewall rules between them are easy to get around. The DHCP server needs a scope for each subnet on the VLAN. ISC DHCP and Kea group them as a shared network, and Windows Server as a superscope.

In the plan, each subnet is its own segment with its own range and gateway, and they all carry the same `vlan` and `site`. Set `shares_vlan_with` on all of them except one, naming another segment on the same VLAN. `ipplan check` then accepts the repeated VLAN; without it, the check warns.

## Starting sets

### Home

| Segment | Typical size | Purpose |
|---|---|---|
| Trusted | /25 | Laptops, phones, the NAS |
| IoT | /26 | TVs, speakers, smart plugs. Internet only, no reach into Trusted |
| Guest | /26 | Internet only |

### Home lab

| Segment | Typical size | Purpose |
|---|---|---|
| Management | /27 | Hypervisor hosts, switch, IPMI or iDRAC |
| Servers | /25 | VMs and containers with fixed addresses |
| Clients | /25 | Everyday devices, mostly DHCP |
| IoT | /26 | Untrusted gadgets |
| Lab | /26 | Things that get rebuilt. Kept away from the rest |

### Small office

| Segment | Typical size | Purpose |
|---|---|---|
| Management | /27 | Firewall, switches, access points. Admins only |
| Servers | /27 | File server, backups, printers |
| Staff | /25 or /24 | Laptops and phones |
| Voice | /26 | Desk phones. QoS (traffic priority) set here |
| Cameras | /27 | Cameras and the recorder. No internet |
| Guest | /25 | Internet only |

### AV and building systems

| Segment | Typical size | Purpose |
|---|---|---|
| Control | /26 | Control processors, touch panels, DSPs. Fixed addresses only |
| AV-over-IP | /24 or larger | Encoders and decoders. Multicast heavy, so give it its own VLAN with IGMP snooping on |
| Dante or AES67 | /25 | Audio network. Keep it separate from AV-over-IP video |
| Building | /26 | HVAC, lighting, access control. Vendor remote access ends here |

Control and audio gear is usually set by hand or by reservation, so give those segments a large fixed block and a small pool, or none at all.

## Block layout inside a segment

A layout that works for most segments, shown for a /26 (64 addresses, offsets from the start):

| Offset | Block | Kind |
|---|---|---|
| +1 | Gateway | fixed |
| +2 to +15 | Infrastructure and fixed devices | fixed |
| +16 to +23 | Room to grow | spare |
| +24 to +62 | DHCP | pool |

Keep the fixed and spare blocks together at the bottom and the pool at the top, so you can move the line between them later without renumbering anything.

## One flat network

A flat network puts every device in one segment, often with no VLAN. That's fine for a home or a small lab where every device can safely reach every other one. Nothing keeps devices apart, though: a cheap camera or smart plug can talk to the NAS directly, with no firewall in between. Once guests, IoT gadgets or work devices need to be kept apart, give them segments of their own.

In a flat network the blocks keep the addresses in order. Give each kind of fixed device a block of its own, put the DHCP pool in one block, and leave spare blocks where things will grow. Leave `vlan` out of the segment if the network has no VLANs. `examples/flat-lab.json` lays out a /24 like this:

| Addresses | Block | Kind |
|---|---|---|
| .1 to .9 | Network gear: router, switch, access points | fixed |
| .10 to .19 | Hypervisors | fixed |
| .20 to .59 | VMs and containers | fixed |
| .60 to .99 | Room to grow | spare |
| .100 to .199 | DHCP | pool |
| .200 to .239 | Printers and gadgets | fixed |
| .240 to .254 | Spare | spare |

With the printers above the pool, the pool can only grow downward, into Room to grow. Set the DHCP server's range to the pool block exactly. Home routers often hand out most of the /24 by default, which overlaps the fixed blocks, so shrink that range before anything gets a fixed address. Give each VM or container a fixed address in its block and set `runs_on` to the hypervisor it runs on.
