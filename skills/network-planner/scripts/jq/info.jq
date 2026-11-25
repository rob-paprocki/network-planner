# ipplan info: describe one CIDR range. Argument: $c (string).
include "ipplan";

# The pre-1993 class, from the first number. Still taught (Network+), never used for routing now.
def class_of: (. / 16777216 | floor) as $o
  | if $o < 128 then "A" elif $o < 192 then "B" elif $o < 224 then "C" elif $o < 240 then "D" else "E" end;

# What kind of space the range is in.
def scope_of:
  . as $x
  | [ ["0.0.0.0/8", "\"this network\" block (not for hosts)"], ["127.0.0.0/8", "loopback (not for hosts)"],
      ["169.254.0.0/16", "link-local (not for hosts)"], ["224.0.0.0/4", "multicast (not for hosts)"],
      ["240.0.0.0/4", "reserved (not for hosts)"], ["100.64.0.0/10", "carrier-grade NAT (shared)"],
      ["10.0.0.0/8", "private (RFC 1918)"], ["172.16.0.0/12", "private (RFC 1918)"], ["192.168.0.0/16", "private (RFC 1918)"],
      ["192.0.2.0/24", "documentation (RFC 5737)"], ["198.51.100.0/24", "documentation (RFC 5737)"],
      ["203.0.113.0/24", "documentation (RFC 5737)"] ]
  | map(select((.[0] | cidr) as $r | overlaps($r; $x))) | first
  | if . == null then "public" else .[1] end;

($c | cidr) as $x
| if $x == null then { ok: false, error: (if ($c | is_v6) then "\($c) is IPv6; this version handles IPv4 only." else "\($c | tojson) isn't an IPv4 CIDR range like 192.0.2.0/24." end) }
  else
    { ok: true, input: $c, network: ($x | cidr_str), aligned: $x.aligned, prefix: $x.prefix, mask: ($x | mask_str),
      addresses: $x.size, usable: ($x | usable),
      first: ($x | first_host | n2ip), last: ($x | last_host | n2ip),
      broadcast: (if $x.prefix >= 31 then null else ($x.bcast | n2ip) end),
      scope: ($x | scope_of), class: ($x.net | class_of) }
  end
