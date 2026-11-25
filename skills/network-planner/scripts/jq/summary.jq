# ipplan summary: render a plan as Markdown, ready to hand to someone or paste into a ticket.
include "ipplan";

def cell: tostring | gsub("\\|"; "\\|") | gsub("\n"; " ");
def row: "| " + (map(cell) | join(" | ")) + " |";
def head($cols): ($cols | row), ([$cols[] | "---"] | row);
def range_str($s; $e): if $s == $e then $s else "\($s) - \($e)" end;
def size_of: ((.end | ip2n) - (.start | ip2n) + 1);
def in_block($b): ((.ip | ip2n) // -1) as $n | $n >= ($b.start | ip2n) and $n <= ($b.end | ip2n);

. as $plan
| [ $plan.segments[]? | select(type == "object") | . + {c: (.cidr | cidr)} ] as $segs
| ($segs | any(.site != null)) as $sites
| [
    "# \($plan.name // "Network plan")",
    "",
    (if ($plan.address_space // []) | length > 0 then "Address space: \($plan.address_space | map("`\(.)`") | join(", "))" else empty end),
    (if $plan.notes then ("", $plan.notes) else empty end),
    "",
    "## Segments",
    "",
    head((if $sites then ["Site"] else [] end) + ["Segment", "VLAN", "Network", "Mask", "Gateway", "Usable", "DHCP pool", "Devices"]),
    ( $segs[]
      | (if $sites then [.site // "-"] else [] end) + [ .name // .id, (.vlan // "-"), (.cidr // "-"),
          (if .c then (.c | mask_str) else "-" end),
          (.gateway // "-"),
          (if .c then (.c | usable) else "-" end),
          ([ .blocks[]? | select(.kind == "pool") | range_str(.start; .end) ] | if length > 0 then join(", ") else "none" end),
          ([ .devices[]? | select(.how != "retire" and .gateway != true) ] | length) ] | row ),
    ( $segs[] | . as $g
      | "",
        "## \(.name // .id) (`\(.cidr)`)",
        "",
        (if .purpose then (.purpose, "") else empty end),
        "First usable \(if .c then (.c | first_host | n2ip) else "-" end), last usable \(if .c then (.c | last_host | n2ip) else "-" end).",
        (if (.blocks // []) | length > 0 then
           "", head(["Block", "Range", "Kind", "Size", "Used"]),
           ( .blocks[] | . as $b
             | [ .name // "unnamed", range_str(.start; .end), (.kind // "fixed"), size_of,
                 ([ $g.devices[]? | select(.how != "retire" and .ip != null) | select(in_block($b)) ] | length) ] | row )
         else empty end),
        (if (.devices // []) | length > 0 then
           "", head(["Device", "Address", "How", "Role", "Moves from"]),
           ( .devices | sort_by((.ip | ip2n) // 4294967296)[]
             | [ .name // "unnamed",
                 (if .ip then .ip elif .how == "dynamic" then "from the pool" else "-" end),
                 (.how // "reserved"), (.role // ""),
                 (if .current_ip and .current_ip != .ip then .current_ip else "" end) ] | row )
         else empty end) ),
    ( [ $segs[] | .devices[]? | select(.current_ip and .ip and .current_ip != .ip and .how != "retire") ] as $mv
      | if ($mv | length) > 0 then
          "", "## Moves", "", head(["Device", "From", "To"]), ($mv[] | [.name, .current_ip, .ip] | row)
        else empty end ),
    ( [ $segs[] | .devices[]? | select(.how == "retire") ] as $rt
      | if ($rt | length) > 0 then
          "", "## Retiring", "", head(["Device", "Address now", "Role"]), ($rt[] | [.name, (.current_ip // .ip // "-"), (.role // "")] | row)
        else empty end )
  ]
| join("\n")
