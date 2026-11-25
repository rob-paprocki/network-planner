# ipplan carve: size segments from host counts and place them inside a parent range.
# Input: null. Arguments: $parent (CIDR string), $reqs ([{name, hosts}]), $avoid ([CIDR strings]).
# Each request gets the smallest block that holds its hosts plus a gateway, rounded to a power of two.
# Biggest first, each on its own boundary, in the lowest free spot. Output: {ok, parent, segments, free, error?}.
include "ipplan";

def place($size; $parent; $taken):
  { pos: $parent.net, done: false }
  | until(.done or (.pos + $size - 1 > $parent.bcast);
      .pos as $p | { net: $p, bcast: ($p + $size - 1) } as $cand
      | ([ $taken[] | select(overlaps(.; $cand)) ] | first) as $o
      | if $o == null then .done = true
        else .pos = ((($o.bcast + 1) / $size | ceil) * $size) end )
  | if .done then .pos else null end;

($parent | cidr) as $P
| [ $avoid[] | cidr | select(. != null) ] as $av
| if $P == null then { ok: false, error: "\($parent | tojson) isn't an IPv4 CIDR range like 192.0.2.0/24." }
  elif ($P.aligned | not) then { ok: false, error: "\($parent) doesn't start on a /\($P.prefix) boundary. Did you mean \($P | cidr_str)?" }
  else
    ( $reqs | to_entries
      | map(.value + { order: .key, prefix: prefix_for(.value.hosts) })
      | map(. + { size: (if .prefix == null then null else p2(32 - .prefix) end) }) ) as $sized
    | ( [ $sized[] | select(.prefix == null or .prefix < $P.prefix) ] ) as $toobig
    | if ($toobig | length) > 0 then
        { ok: false, error: "\($toobig | map("\(.name) (\(.hosts) hosts)") | join(", ")) won't fit in \($parent) even on its own." }
      else
        reduce ( $sized | sort_by(-.size, .order)[] ) as $r
          ( { taken: $av, out: [], failed: [] };
            place($r.size; $P; .taken) as $pos
            | if $pos == null then .failed += [ $r ]
              else { net: $pos, prefix: $r.prefix, size: $r.size, bcast: ($pos + $r.size - 1) } as $c
                | .taken += [ $c ]
                | .out += [ $r + { c: $c } ]
              end )
        | if (.failed | length) > 0 then
            { ok: false, error: "Ran out of room in \($parent) for: \(.failed | map("\(.name) (needs a /\(.prefix))") | join(", ")). Try a bigger range or fewer hosts." }
          else
            ( [ .out[] | .c.size ] | add // 0 ) as $used
            | ( [ $av[] | select(overlaps(.; $P)) | .size ] | add // 0 ) as $held
            | { ok: true, parent: $parent,
                segments: [ .out | sort_by(.c.net)[]
                            | { id: .name, name: .name, cidr: (.c | cidr_str), gateway: (.c | first_host | n2ip),
                                hosts_asked: .hosts, usable: (.c | usable),
                                first: (.c | first_host | n2ip), last: (.c | last_host | n2ip),
                                blocks: [], devices: [] } ],
                free: ($P.size - $used - $held) }
          end
      end
  end
