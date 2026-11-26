#!/usr/bin/env bash
# shellcheck disable=SC2015  # "A && ok || bad": ok always succeeds
# Tests for ipplan. Run from anywhere: bash tests/run.sh
# Check cases live in tests/cases/ and are shared with the JavaScript checker in site/
# Published files may only use example addresses (192.168.100.0/24 and the documentation ranges),
# so larger ranges are tested in private/tests/.

set -u
ROOT=$(cd "$(dirname "$0")/.." && pwd)
NP=$ROOT/skills/network-planner/scripts/ipplan
EX=$ROOT/skills/network-planner/examples/small-office.json
TMP=$(mktemp -d "${TMPDIR:-/tmp}/ipplan-test.XXXXXX")
trap 'rm -rf "$TMP"' EXIT

pass=0; fail=0
ok() { pass=$((pass + 1)); }
bad() { fail=$((fail + 1)); echo "FAIL: $*"; }

# codes PLANFILE -> sorted unique finding codes, space-separated
codes() { "$NP" check --json "$1" | jq -r '[.findings[].code] | unique | join(" ")'; }

# exit status of a command
status() { "$@" >/dev/null 2>&1; echo $?; }

# --- check: every case in tests/cases/check/. The JavaScript checker in site/ runs the same files,
# so a rule change has to land in both. Add a case by writing {name, expect, plan} there.
for f in "$ROOT"/tests/cases/check/*.json; do
    name=$(jq -r .name "$f")
    want=$(jq -r '.expect | unique | join(" ")' "$f")
    jq .plan "$f" > "$TMP/case.json"
    got=$(codes "$TMP/case.json")
    if [ "$got" = "$want" ]; then ok; else bad "check $name: want [$want] got [$got]"; fi
done
[ "$(status "$NP" check "$EX")" = 0 ] && ok || bad "example plan: check should exit 0"

# --- parity: the JavaScript checker gives exactly the same findings, wording included
if command -v node >/dev/null 2>&1; then
    for f in "$ROOT"/tests/cases/check/*.json; do
        jq .plan "$f" > "$TMP/case.json"
        a=$("$NP" check --json "$TMP/case.json" | jq -S -c '.findings | sort_by(.where, .code, .message)')
        b=$(node "$ROOT/site/scripts/check-cli.mjs" "$TMP/case.json" | jq -S -c 'sort_by(.where, .code, .message)')
        if [ "$a" = "$b" ]; then ok; else bad "parity $(jq -r .name "$f"): ipplan $a / js $b"; fi
        # The Markdown summaries match too, malformed plans included, and ipplan summary doesn't fail on them.
        if "$NP" summary "$TMP/case.json" > "$TMP/sum-jq.md" 2>"$TMP/sum-jq.err"; then
            node "$ROOT/site/scripts/summary-cli.mjs" "$TMP/case.json" > "$TMP/sum-js.md"
            if cmp -s "$TMP/sum-jq.md" "$TMP/sum-js.md"; then ok; else bad "summary parity $(jq -r .name "$f"):"; diff "$TMP/sum-jq.md" "$TMP/sum-js.md" | head -10; fi
        else
            bad "summary of case $(jq -r .name "$f") failed: $(head -1 "$TMP/sum-jq.err")"
        fi
    done
else
    echo "skip: node not installed, JavaScript parity not tested"
fi

# --- info and carve: the shared cases in tests/cases/info.json and carve.json
n=$(jq length "$ROOT/tests/cases/info.json")
i=0
while [ "$i" -lt "$n" ]; do
    c=$(jq -c ".[$i]" "$ROOT/tests/cases/info.json")
    input=$(printf '%s' "$c" | jq -r .input)
    "$NP" info --json "$input" > "$TMP/info.json" 2>/dev/null
    if jq -e --argjson c "$c" '. as $g | $c.expect | to_entries | all(.value == $g[.key])' "$TMP/info.json" >/dev/null; then
        ok
    else
        bad "info $input: got $(jq -c . "$TMP/info.json")"
    fi
    i=$((i + 1))
done
n=$(jq length "$ROOT/tests/cases/carve.json")
i=0
while [ "$i" -lt "$n" ]; do
    c=$(jq -c ".[$i]" "$ROOT/tests/cases/carve.json")
    set -- "$(printf '%s' "$c" | jq -r .parent)"
    for r in $(printf '%s' "$c" | jq -r '.requests[] | "\(.name):\(.hosts)"'); do set -- "$@" "$r"; done
    for a in $(printf '%s' "$c" | jq -r '.avoid[]'); do set -- "$@" --avoid "$a"; done
    "$NP" carve --json "$@" > "$TMP/carve.json" 2>/dev/null
    if jq -e --argjson c "$c" '
        (.ok == $c.expect.ok)
        and (($c.expect.cidrs // {}) | to_entries | all(. as $e | any($g_segs[]; .name == $e.key and .cidr == $e.value)))
        and (if $c.expect.free then .free == $c.expect.free else true end)' \
        --argjson g_segs "$(jq -c '.segments // []' "$TMP/carve.json")" "$TMP/carve.json" >/dev/null; then
        ok
    else
        bad "carve $(printf '%s' "$c" | jq -r .name): got $(jq -c . "$TMP/carve.json")"
    fi
    i=$((i + 1))
done

# --- exit codes
jq '.segments[0].vlan = 0' "$EX" > "$TMP/err.json"
[ "$(status "$NP" check "$TMP/err.json")" = 1 ] && ok || bad "errors should exit 1"
jq '.segments[0] |= del(.gateway)' "$EX" > "$TMP/warn.json"
[ "$(status "$NP" check "$TMP/warn.json")" = 2 ] && ok || bad "warnings only should exit 2"
printf '{ not json' > "$TMP/broken.json"
[ "$(status "$NP" check "$TMP/broken.json")" = 1 ] && ok || bad "invalid JSON should exit 1"
[ "$(status "$NP" check "$TMP/missing.json")" = 64 ] && ok || bad "missing file should exit 64"

# --- info
[ "$("$NP" info 203.0.113.0/24 | grep -c -E "^(Network|Scope|Class) ")" = 3 ] && ok || bad "info text output is missing lines for an aligned range"
info() { "$NP" info --json "$1" | jq -r "$2"; }
[ "$(info 198.51.100.77/26 '[.network, .first, .last, .usable, .aligned] | join(" ")')" = "198.51.100.64/26 198.51.100.65 198.51.100.126 62 false" ] && ok || bad "info /26"
[ "$(info 192.0.2.4/31 '[.first, .last, .usable, (.broadcast == null)] | join(" ")')" = "192.0.2.4 192.0.2.5 2 true" ] && ok || bad "info /31"
[ "$(info 192.0.2.9/32 '[.first, .last, .usable] | join(" ")')" = "192.0.2.9 192.0.2.9 1" ] && ok || bad "info /32"
[ "$(info 203.0.113.0/24 '.mask | split(".") | .[3]')" = "0" ] && ok || bad "info mask"
[ "$(status "$NP" info 2001:db8::/64)" = 1 ] && ok || bad "info rejects IPv6"
[ "$(status "$NP" info 192.0.2.0/33)" = 1 ] && ok || bad "info rejects /33"

# --- carve
carve() { "$NP" carve --json "$@"; }
got=$(carve 192.168.100.0/24 users:100 voice:40 cams:20 mgmt:10 | jq -r '[.segments[] | "\(.name)=\(.cidr)"] | join(" ")')
[ "$got" = "users=192.168.100.0/25 voice=192.168.100.128/26 cams=192.168.100.192/27 mgmt=192.168.100.224/28" ] && ok || bad "carve layout: $got"
got=$(carve 192.168.100.0/24 a:62 | jq -r '.segments[0].cidr')
[ "$got" = "192.168.100.0/25" ] && ok || bad "carve: 62 hosts plus a gateway needs a /25, got $got"
got=$(carve 192.168.100.0/24 a:61 | jq -r '.segments[0].cidr')
[ "$got" = "192.168.100.0/26" ] && ok || bad "carve: 61 hosts plus a gateway fits a /26, got $got"
got=$(carve 192.168.100.0/24 x:20 --avoid 192.168.100.0/26 --avoid 192.168.100.64/27 | jq -r '.segments[0].cidr')
[ "$got" = "192.168.100.96/27" ] && ok || bad "carve --avoid: $got"
got=$(carve 10.40.10.0/24 spare:20 --plan "$EX" | jq -r '.segments[0].cidr')
[ "$got" = "10.40.10.224/27" ] && ok || bad "carve --plan: $got"
[ "$(status "$NP" carve 192.168.100.0/24 big:300)" = 1 ] && ok || bad "carve: too big should exit 1"
[ "$(status "$NP" carve 192.168.100.0/24 a:100 b:100 c:100)" = 1 ] && ok || bad "carve: out of room should exit 1"
[ "$(status "$NP" carve 192.168.100.0/24 bad-arg)" = 64 ] && ok || bad "carve: bad NAME:HOSTS should exit 64"
[ "$(status "$NP" carve 192.168.100.0/24 a:5 a:6)" = 64 ] && ok || bad "carve: repeated name should exit 64"
carve 192.168.100.0/24 users:50 > "$TMP/c.json"
jq '{schema: 1, name: "t", segments: .segments}' "$TMP/c.json" > "$TMP/carved-plan.json"
got=$(codes "$TMP/carved-plan.json")
[ -z "$got" ] && ok || bad "a carved segment pasted into a plan should check clean, got [$got]"

# --- summary
"$NP" summary "$EX" > "$TMP/summary.md" || bad "summary exit status"
grep -q '^| Staff | 30 | 10.40.10.64/26 |' "$TMP/summary.md" && ok || bad "summary segment row"
grep -q '^## Moves' "$TMP/summary.md" && ok || bad "summary moves section"

# --- the schema file is valid JSON and the example names it correctly
jq -e '."$schema" and .properties.segments' "$ROOT/skills/network-planner/schema/plan.schema.json" >/dev/null && ok || bad "schema file"

# --- the Copilot package builds, passes its own limit checks, and has the right layout
if command -v zip >/dev/null 2>&1 && command -v unzip >/dev/null 2>&1; then
    if bash "$ROOT/copilot/build.sh" "$TMP/copilot" >/dev/null; then
        ok
        z=$(ls "$TMP"/copilot/network-planner-copilot-*.zip)
        list=$(unzip -Z1 "$z")
        for f in manifest.json declarativeAgent.json color.png outline.png skills/network-planner/SKILL.md; do
            printf '%s\n' "$list" | grep -qx "$f" && ok || bad "copilot zip is missing $f"
        done
        printf '%s\n' "$list" | grep -q '^skills/network-planner/scripts/' && bad "copilot zip should leave out scripts/" || ok
        [ "$(unzip -p "$z" declarativeAgent.json | jq -r '.instructions | startswith("You are Network Planner")')" = true ] \
            && ok || bad "copilot instructions weren't filled in"
    else
        bad "copilot/build.sh failed"
    fi
else
    echo "skip: zip/unzip not installed, Copilot package not tested"
fi

# --- the skill folder carries the license, since it's often copied on its own
cmp -s "$ROOT/LICENSE" "$ROOT/skills/network-planner/LICENSE.txt" && ok || bad "skills/network-planner/LICENSE.txt differs from LICENSE; copy it again"

# --- every example: checks clean in ipplan (and in the JavaScript checker), the site carries the same
# file, and both summaries match. The site's example picker lists the same set.
for ex in "$ROOT"/skills/network-planner/examples/*.json; do
    base=$(basename "$ex")
    [ "$(status "$NP" check "$ex")" = 0 ] && ok || bad "example $base should check clean"
    cmp -s "$ex" "$ROOT/site/public/examples/$base" && ok || bad "site/public/examples/$base differs from the skill's copy; copy it again"
    grep -q "<option value=\"${base%.json}\">" "$ROOT/site/public/index.html" && ok || bad "the site's example picker doesn't list ${base%.json}"
    if command -v node >/dev/null 2>&1; then
        [ "$(node "$ROOT/site/scripts/check-cli.mjs" "$ex")" = "[]" ] && ok || bad "example $base isn't clean in the JavaScript checker"
        "$NP" summary "$ex" > "$TMP/sum-jq.md"
        node "$ROOT/site/scripts/summary-cli.mjs" "$ex" > "$TMP/sum-js.md"
        if cmp -s "$TMP/sum-jq.md" "$TMP/sum-js.md"; then ok; else bad "summary of $base differs between ipplan and the site:"; diff "$TMP/sum-jq.md" "$TMP/sum-js.md" | head -10; fi
    fi
done
[ "$(find "$ROOT/site/public/examples" -name "*.json" | wc -l)" = "$(find "$ROOT/skills/network-planner/examples" -name "*.json" | wc -l)" ] && ok || bad "site/public/examples has files the skill doesn't"

# --- the site's own tests
if command -v node >/dev/null 2>&1; then
    if node --test "$ROOT"/site/test/*.test.js >"$TMP/node-test.log" 2>&1; then ok; else bad "site tests failed:"; tail -20 "$TMP/node-test.log"; fi
fi

echo "ipplan tests: $pass passed, $fail failed."
[ "$fail" = 0 ]
