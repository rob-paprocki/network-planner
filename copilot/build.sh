#!/usr/bin/env bash
# Build the Microsoft 365 Copilot agent package: a zip to upload with "Upload a custom app".
#
#   bash copilot/build.sh [OUTDIR]      default OUTDIR: copilot/build
#
# It puts copilot/instructions.md into the agent manifest, adds the network-planner skill folder
# (without its bash helper, which Copilot can't run), checks the limits Microsoft documents for
# app manifest 1.29 and declarative agent 1.9, and writes network-planner-copilot-VERSION.zip.
# Needs bash 3.2+, jq 1.6+ and zip.

set -eu

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SRC=$ROOT/copilot/appPackage
SKILL=$ROOT/skills/network-planner
OUT=${1:-$ROOT/copilot/build}
STAGE=$OUT/package

fail=0
problem() { echo "copilot/build: $*" >&2; fail=1; }
for c in jq zip; do command -v "$c" >/dev/null 2>&1 || { echo "copilot/build: $c is missing" >&2; exit 1; }; done

rm -rf "$STAGE"
mkdir -p "$STAGE/skills"

cp "$SRC/manifest.json" "$SRC/color.png" "$SRC/outline.png" "$STAGE/"
jq --rawfile ins "$ROOT/copilot/instructions.md" '.instructions = $ins' "$SRC/declarativeAgent.json" > "$STAGE/declarativeAgent.json"

# The skill folder, minus scripts/: Copilot's skill runtime doesn't list .jq files, and the agent
# uses Code Interpreter for the math instead.
mkdir -p "$STAGE/skills/network-planner"
(cd "$SKILL" && find . -type f ! -path './scripts/*' | while IFS= read -r f; do
    mkdir -p "$STAGE/skills/network-planner/$(dirname "$f")"
    cp "$f" "$STAGE/skills/network-planner/$f"
done)

M=$STAGE/manifest.json
A=$STAGE/declarativeAgent.json

# --- app manifest 1.29
len() { jq -r "$1 // \"\" | length" "$2"; }
[ "$(len .name.short "$M")" -le 30 ] || problem "name.short is over 30 characters"
[ "$(len .name.full "$M")" -le 100 ] || problem "name.full is over 100 characters"
[ "$(len .description.short "$M")" -le 80 ] || problem "description.short is over 80 characters"
[ "$(len .description.full "$M")" -le 4000 ] || problem "description.full is over 4000 characters"
[ "$(len .developer.name "$M")" -le 32 ] || problem "developer.name is over 32 characters"
jq -e '.name.short != .name.full' "$M" >/dev/null || problem "name.full must differ from name.short"
jq -e '.description.short as $s | .description.full | contains($s) | not' "$M" >/dev/null \
    || problem "description.full must not repeat description.short"
jq -e '.id | test("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")' "$M" >/dev/null || problem "id isn't a GUID"
jq -e '.accentColor | test("^#[0-9A-Fa-f]{6}$")' "$M" >/dev/null || problem "accentColor isn't #RRGGBB"
for k in manifestVersion version id developer name description icons accentColor; do
    jq -e --arg k "$k" 'has($k)' "$M" >/dev/null || problem "manifest.json is missing $k"
done
for f in $(jq -r '.icons.color, .icons.outline, (.copilotAgents.declarativeAgents[].file)' "$M"); do
    [ -f "$STAGE/$f" ] || problem "manifest.json names $f, which isn't in the package"
done

# Icon sizes, read from the PNG header (width and height are bytes 16-23).
png_size() { od -An -tu1 -j16 -N8 "$1" | awk '{printf "%dx%d", $1*16777216+$2*65536+$3*256+$4, $5*16777216+$6*65536+$7*256+$8}'; }
[ "$(png_size "$STAGE/color.png")" = 192x192 ] || problem "color.png must be 192x192"
[ "$(png_size "$STAGE/outline.png")" = 32x32 ] || problem "outline.png must be 32x32"

# --- declarative agent 1.9
jq -e '.version == "v1.9"' "$A" >/dev/null || problem "declarativeAgent.json version must be v1.9"
[ "$(len .name "$A")" -le 100 ] || problem "agent name is over 100 characters"
[ "$(len .description "$A")" -le 1000 ] || problem "agent description is over 1000 characters"
ins=$(len .instructions "$A")
[ "$ins" -le 8000 ] || problem "instructions are $ins characters; the limit is 8000"
[ "$(jq '.conversation_starters | length' "$A")" -le 12 ] || problem "more than 12 conversation starters"
jq -e '[.conversation_starters[].title] | length == (unique | length)' "$A" >/dev/null || problem "conversation starter titles must be unique"
[ "$(jq '.agent_skills | length' "$A")" -le 8 ] || problem "more than 8 agent skills"
for d in $(jq -r '.agent_skills[].folder' "$A"); do
    [ -f "$STAGE/$d/SKILL.md" ] || problem "agent skill folder $d has no SKILL.md"
done

# --- the skill folder
SK=$STAGE/skills/network-planner
name=$(sed -n 's/^name: *//p' "$SK/SKILL.md" | head -1)
desc=$(sed -n 's/^description: *//p' "$SK/SKILL.md" | head -1)
[ "$name" = network-planner ] || problem "SKILL.md name must equal its folder name"
if [ "${#desc}" -lt 1 ] || [ "${#desc}" -gt 1024 ]; then problem "SKILL.md description must be 1-1024 characters"; fi
companions=$(cd "$SK" && find . -type f ! -name SKILL.md | wc -l | tr -d ' ')
[ "$companions" -le 20 ] || problem "the skill has $companions companion files; the limit is 20"
big=$(find "$SK" -type f -size +5000k | wc -l | tr -d ' ')
[ "$big" = 0 ] || problem "a skill file is over 5 MB"

[ "$fail" = 0 ] || { echo "copilot/build: stopped, no package written" >&2; exit 1; }

version=$(jq -r .version "$M")
ZIP=$OUT/network-planner-copilot-$version.zip
rm -f "$ZIP"
(cd "$STAGE" && zip -q -X -r "$ZIP" manifest.json declarativeAgent.json color.png outline.png skills)
echo "copilot/build: wrote $ZIP ($ins characters of instructions, $companions skill files)"
