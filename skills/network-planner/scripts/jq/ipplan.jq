# Shared IPv4 helpers for ipplan. Plain jq 1.6: no bitwise operators, so all math is arithmetic.
# An address is held as a number 0..4294967295. A parsed CIDR is an object:
#   {addr, net, prefix, size, bcast, aligned}

def p2($n): reduce range(0; $n) as $i (1; . * 2);

# The object entries of a list; anything else (a string, null, a number) yields nothing.
# check reports malformed entries, and summary skips them, the way objectsIn() does in ipplan.js.
def objects_in: if type == "array" then .[] | select(type == "object") else empty end;

# "192.0.2.1" -> number, or null when it isn't a plain dotted-quad IPv4 address.
def ip2n:
  if type != "string" then null
  elif test("^(0|[1-9][0-9]{0,2})(\\.(0|[1-9][0-9]{0,2})){3}$") | not then null
  else (split(".") | map(tonumber)) as $o
    | if any($o[]; . > 255) then null
      else ((($o[0] * 256 + $o[1]) * 256 + $o[2]) * 256 + $o[3]) end
  end;

def n2ip:
  [ (. / 16777216 | floor) % 256, (. / 65536 | floor) % 256, (. / 256 | floor) % 256, . % 256 ]
  | map(tostring) | join(".");

def is_v6: type == "string" and test(":");

# "192.0.2.0/24" -> parsed object, or null.
def cidr:
  if type != "string" then null
  else ([match("^([^/]+)/([0-9]{1,2})$").captures[].string] | if length == 2 then . else null end) as $m
    | if $m == null then null
      else ($m[0] | ip2n) as $a | ($m[1] | tonumber) as $p
        | if $a == null or $p > 32 then null
          else p2(32 - $p) as $size | (($a / $size | floor) * $size) as $net
            | {addr: $a, net: $net, prefix: $p, size: $size, bcast: ($net + $size - 1), aligned: ($a == $net)}
          end
      end
  end;

def cidr_str: "\(.net | n2ip)/\(.prefix)";
def mask_str: (4294967296 - .size) | n2ip;

# First and last address a host can use. /31 (RFC 3021) and /32 have no network or broadcast address.
def first_host: if .prefix >= 31 then .net else .net + 1 end;
def last_host: if .prefix >= 31 then .bcast else .bcast - 1 end;
def usable: if .prefix == 32 then 1 elif .prefix == 31 then 2 else .size - 2 end;

# Is the number $n the network or broadcast address of this parsed CIDR?
def reserved($n): .prefix < 31 and ($n == .net or $n == .bcast);
def contains_n($n): $n >= .net and $n <= .bcast;
def contains_c($c): $c.net >= .net and $c.bcast <= .bcast;
def overlaps($a; $b): $a.net <= $b.bcast and $b.net <= $a.bcast;

# Smallest prefix whose usable count holds $hosts plus a gateway.
def prefix_for($hosts):
  [range(30; -1; -1) | select(p2(32 - .) - 2 >= $hosts + 1)] | first;
