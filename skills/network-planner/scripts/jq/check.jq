# ipplan check: read a plan, emit an array of findings {level, where, code, message}.
include "ipplan";

def E($w; $c; $m): {level: "error", where: $w, code: $c, message: $m};
def W($w; $c; $m): {level: "warning", where: $w, code: $c, message: $m};

# A number as plain arithmetic leaves it, so jq 1.7 writes a VLAN of 30.0 or 3e1 as 30, like the
# JavaScript checker does. Anything else passes through.
def num_text: if type == "number" then . + 0 else . end;

def KINDS: ["fixed", "pool", "spare"];
def HOWS: ["static", "reserved", "dynamic", "retire"];

def bad_addr($w; $field; $v):
  if ($v | is_v6) then E($w; "ipv6-unsupported"; "\($field) \($v) is IPv6; this version plans IPv4 only.")
  else E($w; "bad-address"; "\($field) \($v | tojson) isn't an IPv4 address like 192.0.2.10.") end;

def bad_cidr($w; $field; $v):
  if ($v | is_v6) then E($w; "ipv6-unsupported"; "\($field) \($v) is IPv6; this version plans IPv4 only.")
  else E($w; "bad-cidr"; "\($field) \($v | tojson) isn't a CIDR range like 192.0.2.0/24.") end;

# objects_in (in ipplan.jq) gives the object entries of a list. Malformed entries are reported by
# shape_errors, not crashed on.

# A list field that isn't a list, or holds entries that aren't objects.
def shape_errors($where; $field; $v):
  if $v == null then empty
  elif ($v | type) != "array" then E($where; "bad-structure"; "\"\($field)\" must be a list.")
  elif any($v[]; type != "object") then E($where; "bad-structure"; "Every entry in \"\($field)\" must be an object.")
  else empty end;

# Normalise segments: parsed CIDR, parsed blocks and devices, and a label for messages.
def segments:
  [ (.segments // []) | if type == "array" then .[] else empty end | select(type == "object") ]
  | to_entries
  | map(.key as $i | .value as $s
      | ($s.id // "#\($i + 1)") as $id
      | { i: $i, id: $id, raw: $s, c: ($s.cidr | cidr), label: "segment \($id)",
          gw: ($s.gateway | ip2n),
          blocks: [ $s.blocks | objects_in | . as $b
                    | {raw: $b, name: ($b.name // "unnamed"), kind: ($b.kind // "fixed"),
                       s: ($b.start | ip2n), e: ($b.end | ip2n)} ],
          devices: [ $s.devices | objects_in | . as $d
                     | {raw: $d, name: ($d.name // "unnamed"), how: ($d.how // "reserved"),
                        n: ($d.ip | ip2n), cur: ($d.current_ip | ip2n)} ] });

# Ranges devices can't use, the shared carrier-grade NAT range, and the ranges where a plan is
# expected to live (private and documentation). Anything else is public address space.
def SPECIAL: [
  {r: "0.0.0.0/8", what: "the \"this network\" block"},
  {r: "127.0.0.0/8", what: "the loopback range"},
  {r: "169.254.0.0/16", what: "the link-local range"},
  {r: "224.0.0.0/4", what: "the multicast range"},
  {r: "240.0.0.0/4", what: "the reserved block"} ] | map(. + {c: (.r | cidr)});
def CGNAT: "100.64.0.0/10" | cidr;
def PLANNABLE: ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "192.0.2.0/24", "198.51.100.0/24", "203.0.113.0/24"] | map(cidr);

# Findings for a parsed range $c written as $raw, at $w. $warn: also report CGNAT and public space.
def range_findings($w; $raw; $c; $warn):
  ([ SPECIAL[] | select(overlaps(.c; $c)) ] | first) as $s
  | if $s != null then E($w; "special-range"; "\($raw) overlaps \($s.what) (\($s.r)), which devices can't use as normal addresses.")
    elif ($warn | not) then empty
    elif overlaps(CGNAT; $c) then W($w; "cgnat-range"; "\($raw) is in the carrier-grade NAT range (100.64.0.0/10). Use it only if you're sure your ISP and VPNs don't.")
    elif ([ PLANNABLE[] | contains_c($c) ] | any | not) then W($w; "public-range"; "\($raw) is public address space. That's right only if your organisation owns it; private networks use 10.0.0.0/8, 172.16.0.0/12 or 192.168.0.0/16.")
    else empty end;

def block_of($seg; $n): [ $seg.blocks[] | select(.s != null and .e != null and $n >= .s and $n <= .e) ] | first;

# Why a segment's "shares_vlan_with" doesn't hold, or null when it holds or isn't set.
# The first segment in plan order with that id is the one it names.
def share_problem($segs):
  .raw as $s | $s.shares_vlan_with as $v
  | if $v == null then null
    elif ($v | type) != "string" then "\"shares_vlan_with\" must be the id of another segment."
    elif $v == $s.id then "\"shares_vlan_with\" names this segment itself."
    else
      ([ $segs[] | select(.raw.id == $v) ] | first) as $t
      | if $t == null then "\"shares_vlan_with\" names segment \($v), which isn't in the plan."
        elif $t.raw.site != $s.site then "Shares a VLAN with segment \($v), which is at a different site."
        elif $s.vlan == null or $t.raw.vlan == null then "Shares a VLAN with segment \($v), so both need the same \"vlan\"."
        elif $t.raw.vlan != $s.vlan then
          "Shares a VLAN with segment \($v), but that segment is on VLAN \($t.raw.vlan | num_text) and this one is on VLAN \($s.vlan | num_text)."
        else null end
    end;

# The segment says which segment's VLAN it shares, and that holds up.
def shares_vlan($segs): .raw.shares_vlan_with != null and share_problem($segs) == null;

def check_segment($space; $segs):
  . as $g | $g.label as $L
  | shape_errors($L; "blocks"; $g.raw.blocks),
    shape_errors($L; "devices"; $g.raw.devices),
    (if $g.raw.id == null then E($L; "missing-id"; "Give the segment a short \"id\", such as \"users\".") else empty end),
    (if $g.raw.name == null then W($L; "missing-name"; "Give the segment a \"name\" people will recognise.") else empty end),
    (if $g.raw.cidr == null then E($L; "missing-cidr"; "The segment needs a \"cidr\", such as 192.0.2.0/26.")
     elif $g.c == null then bad_cidr($L; "cidr"; $g.raw.cidr)
     elif ($g.c.aligned | not) then
       E($L; "misaligned-cidr"; "\($g.raw.cidr) doesn't start on a /\($g.c.prefix) boundary. Did you mean \($g.c | cidr_str)?")
     else empty end),
    (if $g.c != null and $g.c.aligned then range_findings($L; $g.raw.cidr; $g.c; true) else empty end),
    (if $g.raw.vlan == null then empty
     elif ($g.raw.vlan | type) != "number" or $g.raw.vlan != ($g.raw.vlan | floor) or $g.raw.vlan < 1 or $g.raw.vlan > 4094 then
       E($L; "vlan-range"; "VLAN \($g.raw.vlan | num_text | tojson) is outside 1-4094.")
     else empty end),
    ($g | share_problem($segs) | if . != null then E($L; "bad-vlan-share"; .) else empty end),
    (if $g.c != null and ($space | length) > 0 and ([ $space[] | select(.c != null) | .c | contains_c($g.c) ] | any | not) then
       E($L; "outside-space"; "\($g.raw.cidr) isn't inside the plan's address_space.")
     else empty end),

    # gateway
    (if $g.raw.gateway == null then
       (if $g.c != null and $g.c.prefix < 31 then
          W($L; "no-gateway"; "No gateway set. Most segments use the first usable address, \($g.c | first_host | n2ip).")
        else empty end)
     elif $g.gw == null then bad_addr($L; "gateway"; $g.raw.gateway)
     elif $g.c == null then empty
     elif ($g.c | contains_n($g.gw) | not) then E($L; "gateway-outside"; "Gateway \($g.raw.gateway) isn't inside \($g.raw.cidr).")
     elif ($g.c | reserved($g.gw)) then E($L; "gateway-reserved"; "Gateway \($g.raw.gateway) is the segment's network or broadcast address.")
     elif (block_of($g; $g.gw) // {}).kind == "pool" then
       E($L; "gateway-in-pool"; "Gateway \($g.raw.gateway) is inside pool block \(block_of($g; $g.gw).name | tojson), so DHCP could give it out.")
     else empty end),

    # blocks
    ( $g.blocks[] | . as $b | "\($L), block \($b.name)" as $BL
      | (if (KINDS | index($b.kind)) == null then E($BL; "block-kind"; "kind \($b.kind | tojson) must be fixed, pool or spare.") else empty end),
        (if $b.s == null then bad_addr($BL; "start"; $b.raw.start) else empty end),
        (if $b.e == null then bad_addr($BL; "end"; $b.raw.end) else empty end),
        (if $b.s == null or $b.e == null then empty
         elif $b.s > $b.e then E($BL; "block-order"; "Starts at \($b.raw.start), after its end \($b.raw.end).")
         elif $g.c == null then empty
         elif ($g.c | (contains_n($b.s) and contains_n($b.e)) | not) then
           E($BL; "block-outside"; "\($b.raw.start)-\($b.raw.end) runs outside \($g.raw.cidr).")
         elif $g.c.prefix < 31 and ($b.s == $g.c.net or $b.e == $g.c.bcast) then
           W($BL; "block-reserved"; "Includes the segment's network or broadcast address. Keep it within \($g.c | first_host | n2ip)-\($g.c | last_host | n2ip).")
         else empty end) ),
    ( [ $g.blocks[] | select(.s != null and .e != null and .s <= .e) ] as $bs
      | range(0; $bs | length) as $x | range($x + 1; $bs | length) as $y
      | select($bs[$x].s <= $bs[$y].e and $bs[$y].s <= $bs[$x].e)
      | E("\($L), block \($bs[$x].name)"; "block-overlap"; "Overlaps block \($bs[$y].name).") ),
    (if ([ $g.blocks[] | select(.kind == "pool") ] | length) == 0 and ([ $g.devices[] | select(.how == "dynamic") ] | length) > 0 then
       E($L; "no-pool"; "Devices are marked dynamic, but the segment has no pool block.")
     else empty end),

    # devices
    ( $g.devices[] | . as $d | "\($L), device \($d.name)" as $DL
      | (if $d.raw.name == null then E($DL; "missing-name"; "A device has no \"name\".") else empty end),
        (if (HOWS | index($d.how)) == null then E($DL; "device-how"; "how \($d.how | tojson) must be static, reserved, dynamic or retire.") else empty end),
        (if $d.raw.current_ip != null and $d.cur == null then bad_addr($DL; "current_ip"; $d.raw.current_ip) else empty end),
        (if $d.raw.gateway == true and $d.how != "retire" and $g.gw != null and $d.n != null and $d.n != $g.gw then
           W($DL; "gateway-mismatch"; "Marked as the gateway, but the segment's gateway is \($g.raw.gateway), not \($d.raw.ip).")
         else empty end),
        # "runs_on" names the device this one runs on. Any device in the plan counts, a retiring one too.
        ($d.raw.runs_on as $on
         | if $on == null then empty
           elif ($on | type) != "string" then E($DL; "bad-runs-on"; "\"runs_on\" must be the name of another device.")
           elif $on == $d.raw.name then E($DL; "bad-runs-on"; "\"runs_on\" names this device itself.")
           elif (any($segs[].devices[]; .raw.name == $on) | not) then
             W($DL; "runs-on-missing"; "\"runs_on\" names \($on), which isn't a device in the plan.")
           else empty end),
        (if $d.how == "retire" then empty
         elif $d.raw.ip == null then
           (if $d.how == "dynamic" then empty else E($DL; "needs-address"; "A \($d.how) device needs a planned \"ip\".") end)
         elif $d.n == null then bad_addr($DL; "ip"; $d.raw.ip)
         elif $g.c == null then empty
         elif ($g.c | contains_n($d.n) | not) then E($DL; "device-outside"; "\($d.raw.ip) isn't inside \($g.raw.cidr).")
         elif ($g.c | reserved($d.n)) then E($DL; "device-reserved"; "\($d.raw.ip) is the segment's network or broadcast address.")
         elif $g.gw != null and $d.n == $g.gw and ($d.raw.gateway != true) then
           E($DL; "device-on-gateway"; "\($d.raw.ip) is the segment's gateway. If this device is the gateway, add \"gateway\": true.")
         else
           block_of($g; $d.n) as $b
           | (if ($g.blocks | length) > 0 and $b == null then W($DL; "no-block"; "\($d.raw.ip) is in no block.")
              elif $b == null then empty
              elif $b.kind == "pool" and $d.how != "dynamic" then
                E($DL; "fixed-in-pool"; "\($d.raw.ip) is a \($d.how) address inside pool block \($b.name | tojson). DHCP could give it to another device as well.")
              elif $b.kind != "pool" and $d.how == "dynamic" then W($DL; "dynamic-outside-pool"; "Marked dynamic, but \($d.raw.ip) is outside the pool.")
              elif $b.kind == "spare" then W($DL; "in-spare"; "\($d.raw.ip) is in the spare block \($b.name).")
              else empty end),
             (if $g.c.prefix < 24 and ($d.n % 256 == 0 or $d.n % 256 == 255) then
                W($DL; "edge-octet"; "\($d.raw.ip) is valid in a /\($g.c.prefix), but some devices refuse addresses ending in .0 or .255.")
              else empty end)
         end) );

if type != "object" then [ E("plan"; "not-an-object"; "The plan must be a JSON object.") ]
else
  . as $plan
  | segments as $segs
  | [ ($plan.address_space // []) | if type == "array" then .[] else . end | {raw: ., c: cidr} ] as $space
  | [
      (if $plan.schema != 1 then E("plan"; "schema"; "Set \"schema\": 1 at the top of the plan.") else empty end),
      shape_errors("plan"; "segments"; $plan.segments),
      (if ($segs | length) == 0 then E("plan"; "no-segments"; "The plan has no segments yet.") else empty end),
      ( $space[] | .raw as $r | .c as $c
        | if $c == null then bad_cidr("address_space"; "range"; $r)
          elif ($c.aligned | not) then E("address_space"; "misaligned-cidr"; "\($r) doesn't start on a /\($c.prefix) boundary. Did you mean \($c | cidr_str)?")
          else range_findings("address_space"; $r; $c; false) end ),
      ( $segs[] | check_segment($space; $segs) ),
      ( [ $segs[] | select(.c != null) ] as $cs
        | range(0; $cs | length) as $x | range($x + 1; $cs | length) as $y
        | select(overlaps($cs[$x].c; $cs[$y].c))
        | E($cs[$x].label; "segment-overlap"; "\($cs[$x].raw.cidr) overlaps segment \($cs[$y].id) (\($cs[$y].raw.cidr)).") ),
      ( [ $segs[] | .raw.id | select(. != null) ] | group_by(.) | map(select(length > 1))[]
        | E("segment \(.[0])"; "duplicate-id"; "\(length) segments share the id \(.[0] | tojson).") ),
      # VLAN numbers only have to be unique within a site; segments with no site share one scope.
      # A shared VLAN is fine when all but one of its segments say so with "shares_vlan_with".
      ( [ $segs[] | select(.raw.vlan != null) | {v: .raw.vlan, site: .raw.site, id, ok: shares_vlan($segs)} ]
        | group_by([.site, .v]) | map(select(length > 1 and ([ .[] | select(.ok | not) ] | length) > 1))[]
        | (if .[0].site != null then " at site \(.[0].site | num_text)" else "" end) as $at
        | (.[0].v | num_text) as $v
        | W("vlan \($v)\($at)"; "duplicate-vlan";
            "Segments \(map(.id) | join(", ")) share VLAN \($v)\($at). If that's on purpose, add \"shares_vlan_with\" to all but one of them.") ),
      ( [ $segs[] | .id as $sid | .devices[] | select(.how != "retire" and .n != null) | {n, name, sid: $sid} ]
        | group_by(.n) | map(select(length > 1))[]
        | E("address \(.[0].n | n2ip)"; "duplicate-address"; "Planned for more than one device: \(map("\(.name) (\(.sid))") | join(", ")).") )
    ]
end
