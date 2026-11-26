# ipplan summary: render a plan as Markdown, ready to hand to someone or paste into a ticket.
# summary() in site/public/ipplan.js prints exactly the same text, so change them together.
# Both read values the same way: null, false and "" count as missing, a value that isn't a
# string prints as JSON, and a list keeps only its object entries.
include "ipplan";

# A number as plain arithmetic leaves it, so jq 1.7 writes a VLAN of 30.0 as 30, like the site does.
def num_text: if type == "number" then . + 0 else . end;
def present: . != null and . != false and . != "";
def otherwise($d): if present then . else $d end;
# A value as text: null is empty, a string is itself, anything else is JSON.
def text: if . == null then "" elif type == "string" then . else num_text | tojson end;
def cell: text | gsub("\\|"; "\\|") | gsub("\n"; " ");
def row: "| " + (map(cell) | join(" | ")) + " |";
def head($cols): ($cols | row), ([$cols[] | "---"] | row);
def range_str($s; $e): if $s == $e then $s else "\($s | text) - \($e | text)" end;
def size_of: (.start | ip2n) as $lo | (.end | ip2n) as $hi
  | if $lo != null and $hi != null then $hi - $lo + 1 else "-" end;
def in_block($b): (.ip | ip2n) as $n | ($b.start | ip2n) as $lo | ($b.end | ip2n) as $hi
  | $n != null and $lo != null and $hi != null and $n >= $lo and $n <= $hi;
def seg_name: .id as $id | .name | otherwise($id);
def dev_name: .name | otherwise("unnamed");

. as $plan
| [ $plan.segments | objects_in | . + {c: (.cidr | cidr)} ] as $segs
| ($segs | any(.site != null)) as $sites
| ($plan.address_space | if type == "array" then . else [] end) as $space
# Any device saying what it runs on adds a "Runs on" column to every devices table.
| ([ $segs[] | .devices | objects_in | select((.runs_on | type) == "string") ] | length > 0) as $runs
| [
    "# \($plan.name | otherwise("Network plan") | text)",
    "",
    (if ($space | length) > 0 then "Address space: \($space | map("`\(text)`") | join(", "))" else empty end),
    (if ($plan.notes | present) then ("", ($plan.notes | text)) else empty end),
    "",
    "## Segments",
    "",
    head((if $sites then ["Site"] else [] end) + ["Segment", "VLAN", "Network", "Mask", "Gateway", "Usable", "DHCP pool", "Devices"]),
    ( $segs[]
      | (if $sites then [.site | otherwise("-")] else [] end) + [ seg_name,
          ((.vlan | otherwise("-") | num_text) as $vlan
           | if (.shares_vlan_with | type) == "string" then "\($vlan) (shared with \(.shares_vlan_with))" else $vlan end),
          (.cidr | otherwise("-")),
          (if .c then (.c | mask_str) else "-" end),
          (.gateway | otherwise("-")),
          (if .c then (.c | usable) else "-" end),
          ([ .blocks | objects_in | select(.kind == "pool") | range_str(.start; .end) | text ]
           | if length > 0 then join(", ") else "none" end),
          ([ .devices | objects_in | select(.how != "retire" and .gateway != true) ] | length) ] | row ),
    ( $segs[]
      | [ .blocks | objects_in ] as $blocks
      | [ .devices | objects_in ] as $devs
      | "",
        "## \(seg_name | text)\(if (.cidr | present) then " (`\(.cidr | text)`)" else "" end)",
        "",
        (if (.purpose | present) then ((.purpose | text), "") else empty end),
        "First usable \(if .c then (.c | first_host | n2ip) else "-" end), last usable \(if .c then (.c | last_host | n2ip) else "-" end).",
        (if ($blocks | length) > 0 then
           "", head(["Block", "Range", "Kind", "Size", "Used"]),
           ( $blocks[] | . as $b
             | [ (.name | otherwise("unnamed")), range_str(.start; .end), (.kind | otherwise("fixed")), size_of,
                 ([ $devs[] | select(.how != "retire") | select(in_block($b)) ] | length) ] | row )
         else empty end),
        (if ($devs | length) > 0 then
           "", head(["Device", "Address", "How", "Role"] + (if $runs then ["Runs on"] else [] end) + ["Moves from"]),
           ( $devs | sort_by((.ip | ip2n) // 4294967296)[]
             | [ dev_name,
                 (if (.ip | present) then .ip elif .how == "dynamic" then "from the pool" else "-" end),
                 (.how | otherwise("reserved")), (.role | otherwise("")) ]
               + (if $runs then [ (if (.runs_on | type) == "string" then .runs_on else "" end) ] else [] end)
               + [ (if (.current_ip | present) and .current_ip != .ip then .current_ip else "" end) ] | row )
         else empty end) ),
    ( [ $segs[] | .devices | objects_in
        | select((.current_ip | present) and (.ip | present) and .current_ip != .ip and .how != "retire") ] as $mv
      | if ($mv | length) > 0 then
          "", "## Moves", "", head(["Device", "From", "To"]), ($mv[] | [dev_name, .current_ip, .ip] | row)
        else empty end ),
    ( [ $segs[] | .devices | objects_in | select(.how == "retire") ] as $rt
      | if ($rt | length) > 0 then
          "", "## Retiring", "", head(["Device", "Address now", "Role"]),
          ($rt[] | [dev_name, ((.ip | otherwise("-")) as $ip | .current_ip | otherwise($ip)), (.role | otherwise(""))] | row)
        else empty end )
  ]
| join("\n")
