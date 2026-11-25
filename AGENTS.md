# Notes for coding agents

## How this project is published

Development happens in a separate repository. The public repository gets one commit per released
version and nothing else.

If there's a `private/` folder at the top of the repository, you're in the development repository.
Read `private/README.md` before you change anything. It says what may and may not reach the public
repository. When you're asked to cut a release, follow `private/RELEASING.md`.

If there's no `private/` folder, you're in the public repository. Don't commit or push here. A commit on
its `main` stops the next release until someone removes it. To suggest a change, open an issue or a pull
request. It won't be merged here, but it can be copied into the development repository and ship with the
next release.

## This project

The product is one self-contained skill folder, `skills/network-planner/`. Copying that folder is a
complete install, so anything the skill needs at run time goes inside it.

| Path | What it is |
|---|---|
| `skills/network-planner/SKILL.md` | The skill: how to interview someone and build a plan |
| `skills/network-planner/scripts/ipplan` | The CLI. bash 3.2 and jq 1.6 only |
| `skills/network-planner/scripts/jq/` | The jq programs behind each subcommand. `ipplan.jq` holds the shared IPv4 math |
| `skills/network-planner/schema/plan.schema.json` | JSON Schema for plan files |
| `skills/network-planner/references/` | Format reference and segment advice, loaded by the skill when needed |
| `.claude-plugin/` | Lets Claude Code install the repo as a plugin |
| `site/` | The web planner and API (a Cloudflare Worker). `public/ipplan.js` is the JavaScript checker, `public/app.js` the page, `src/worker.js` the API. Wrangler needs Node 22 |
| `tests/cases/` | Shared test cases: `check/*.json` ({name, expect, plan}), `info.json`, `carve.json`. Both checkers run them |
| `copilot/` | The Microsoft 365 Copilot agent package. `build.sh` inlines `instructions.md` into the agent manifest, copies the skill folder without `scripts/`, checks Microsoft's documented limits and zips it |
| `tests/run.sh` | Tests, using example addresses only |

When you change the checks in `ipplan`, change the matching list in `copilot/instructions.md` too, because the
Copilot agent can't run the helper. The icons come from `private/tools/make-icons.py`. After regenerating
them, update their hashes in `scripts/release/approved-binaries.sha256`.

Rules:

- Run `bash tests/run.sh` and `shellcheck` on every shell file before committing. The private repository
  also has larger-range tests in `private/tests/run.sh`.
- Keep the shell bash 3.2 compatible (macOS): no associative arrays, `mapfile`, `${x,,}` or `[[ -v ]]`, and guard
  empty arrays under `set -u`. Keep jq to 1.6 builtins.
- The publish check is `scripts/check_public.py` (set as `CHECK_SCRIPT`). It allows any private
  (RFC 1918) address, the special ranges the checker talks about, and the documentation ranges. Public
  addresses still fail, and so does anything on the private word list, which is where the owner's own
  networks are blocked. Never write those into a public file or into the check script. Dotted netmasks
  outside those ranges (`255.255.255.0`) fail too, so write prefix lengths (`/24`). A test that needs a
  public address goes in `private/tests/`.
- The version number lives in `scripts/ipplan` (`VERSION=`) and `.claude-plugin/plugin.json`. The
  release kit updates both.
