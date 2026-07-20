# Handoff — ruflo (Grok host) — 2026-07-20

Ruflo is the rUv agent meta-harness (MCP + CLI + hooks + swarms + AgentDB). This checkout is a **weave-logic-ai fork** adapted so the harness runs **in Grok Build**, with agent teams and skills treated as critical. Branch `feat/grok-host` has host surface committed + pushed, plus uncommitted product work: Brain wiring, MCP `team_*` tools, and `init --grok`.

## Current state

- Branch `feat/grok-host` tracking `origin/feat/grok-host`
  - **Pushed:** `89a7eaa1e` — host surface (`.grok/`, team bus scripts, ADR-320, docs)
  - **Dirty (local, not yet committed):** team MCP tools, `init --grok`, Brain config, templates, tests
- Remotes:
  - `origin` → `git@github.com:weave-logic-ai/ruflo.git`
  - `upstream` → `git@github.com:ruvnet/ruflo.git`
- Toolchain: Node **v22.23.1**, `grok` at `~/.grok/bin/grok`, published **`ruflo v3.32.8`** via `npx -y ruflo@latest`
- Local monorepo CLI **`v3/@claude-flow/cli/dist` still missing** unless pnpm build finishes — published MCP still has **327 tools** (no `team_*` until local build or publish)
- Smoke team `smoke-demo` **cleared** (`.claude-flow/teams/` empty)
- RuvNet Brain **installed** at `~/.cache/ruvnet-brain/kb` (v3.4.21-dev, 60 repos)
- Brain MCP wired in project `.grok/config.toml`; **handshake OK, 1 tool** (`search_ruvnet`) after patching missing `forge-hybrid.mjs`
- Memory: pattern `grok-host-smoke` still present

### Uncommitted (next commit)

```
.grok/config.toml                 # ruvnet-brain MCP + permissions
.grok/skills/agent-teams-grok/    # MCP team_* preferred
docs/grok/README.md
v3/docs/adr/ADR-320-*.md          # status bump
v3/@claude-flow/cli/src/mcp-tools/team-tools.ts
v3/@claude-flow/cli/src/mcp-client.ts
v3/@claude-flow/cli/src/mcp-tools/index.ts
v3/@claude-flow/cli/src/init/grok-generator.ts
v3/@claude-flow/cli/src/commands/init.ts   # --grok
v3/@claude-flow/cli/src/init/index.ts
v3/@claude-flow/cli/package.json          # templates/ in files
v3/@claude-flow/cli/templates/grok/**     # init templates
v3/@claude-flow/cli/__tests__/team-tools.test.ts
docs/handoff.md
```

## What's working (verified)

| Thing | State | Verified how |
|---|---|---|
| Commit+push host surface | works | `git push -u origin feat/grok-host` → `89a7eaa1e` |
| Clear smoke-demo | works | shutdown + `rm -rf .claude-flow/teams/smoke-demo` |
| Team bus CLI MVP | works | create/plan/spawn/send/inbox/on-stop/shutdown on `smoke2` |
| Grok templates pack | works | walk-copy smoke → config + bus + 4 agents |
| RuvNet Brain install | works | `npx ruvnet-brain@latest --yes …` exit 0; doctor healthy install |
| Brain MCP handshake | works | `grok mcp doctor ruvnet-brain` → handshake OK, 1 tool (after forge-hybrid copy) |
| Ruflo MCP (published) | works | doctor → 327 tools (no team_* yet on published) |
| `team_*` source | written | 9 tools registered in `mcp-client.ts` |
| `init --grok` source | written | flag + `executeGrokInit` + templates |

## Done this session (resume)

- Cleared leftover `smoke-demo` team
- Committed + pushed Phase 0 host surface to weave-logic-ai
- Installed RuvNet Brain (843MB bundle) + wired project MCP
- Patched missing `forge-hybrid.mjs` into kb (release zip incomplete vs marketplace)
- Implemented ADR-320 MCP tools: `team_create/spawn/send/inbox/broadcast/plan/status/on_stop/shutdown`
- Productized `init --grok` + CLI `templates/grok/`
- Updated skill/docs to prefer MCP over CLI bus

## Measurements & calibration

| Metric | Value | Notes |
|---|---|---|
| Brain download | **843MB** zip (~20 min cold) | v3.4.21-dev |
| Brain MCP tools | **1** (`search_ruvnet`) | after forge-hybrid fix |
| Ruflo published tools | **327** | no team_* until build/publish |
| Team bus smoke | create→shutdown OK | temp dir `smoke2` |
| Memory search "grok host" | score **0.77**, ~20ms | prior session pattern |

## Dead ends — do not retry

- **Pointing MCP at unbuilt monorepo CLI** — still no `dist/`; use `npx -y ruflo@latest` until pnpm build.
- **Expecting published ruflo@latest to expose `team_*` immediately** — source-only until local build or npm publish.
- **Brain bundle alone without forge-hybrid.mjs** — release zip missing hybrid module; MCP handshake fails. Fix: `cp ~/.claude/plugins/marketplaces/ruvnet-brain/kb/forge-hybrid.mjs ~/.cache/ruvnet-brain/kb/`
- **npm install inside `v3/@claude-flow/cli` alone** — `workspace:*` / v3 monorepo root; use **pnpm** from `v3/`.
- **Claude SendMessage on Grok** — still wrong; use team bus / MCP.
- **Hardcoding only HOME tilde in Grok MCP args** — use absolute path to forge-mcp-all.mjs (project config does).

## Open threads

1. **Commit + push product delta** (team tools, init --grok, brain config, templates) — in progress at handoff write time.
2. **Local build** — `cd v3 && pnpm install --filter @claude-flow/cli... && pnpm --filter @claude-flow/cli build` then point MCP at local bin **or** publish.
3. **Vitest** — `__tests__/team-tools.test.ts` ready once deps installed.
4. **Brain grounding demo** — doctor install healthy but first-ask may need model warm-up (`npx ruvnet-brain --demo`).
5. **Optional RuVector MCP** — not installed; brain answers work without it.
6. **Conformance bench vs Claude host** — not started.
7. **Upstream PR** — keep host-agnostic; do not force-push upstream.

## Resume here

```bash
cd /Users/mathewbeane/dev/ruflo
git checkout feat/grok-host
git status -sb

# Verify MCPs
grok mcp list
grok mcp doctor ruflo
grok mcp doctor ruvnet-brain

# If brain handshake fails on forge-hybrid:
cp ~/.claude/plugins/marketplaces/ruvnet-brain/kb/forge-hybrid.mjs \
   ~/.cache/ruvnet-brain/kb/forge-hybrid.mjs

# Build team_* into local CLI (when pnpm ready)
cd v3
pnpm install --filter @claude-flow/cli...
pnpm --filter @claude-flow/cli build
pnpm --filter @claude-flow/cli exec vitest run __tests__/team-tools.test.ts

# Optional: point .grok/config.toml ruflo MCP at local:
#   command = "node"
#   args = ["…/v3/@claude-flow/cli/bin/cli.js", "mcp", "start"]

# Init smoke (from built package or tsx)
# npx -y ruflo@latest init --grok --force   # only after publish
```

## Key paths

- `docs/handoff.md` — this file
- `.grok/config.toml` — ruflo + ruvnet-brain MCP
- `v3/@claude-flow/cli/src/mcp-tools/team-tools.ts` — ADR-320 MCP tools
- `v3/@claude-flow/cli/src/init/grok-generator.ts` — `init --grok`
- `v3/@claude-flow/cli/templates/grok/` — scaffold templates
- `scripts/grok-team-bus.mjs` — CLI fallback bus
- `~/.cache/ruvnet-brain/kb/forge-mcp-all.mjs` — Brain MCP entry
- `v3/docs/adr/ADR-320-grok-host-agnostic-agent-teams.md`

## Gotchas

- **Restart Grok** after `.grok/config.toml` edits so MCP list refreshes in-session.
- **forge-hybrid.mjs** missing from some brain zip extracts — copy from marketplace clone.
- **Published vs local tools** — in-session `ruflo` MCP is still npx latest until you rewire to local dist.
- **Absolute path** to forge-mcp-all embeds username — other machines must edit `.grok/config.toml`.
- **Do not commit to main**; keep work on `feat/grok-host`.
- **Don't commit secrets**; brain is under `~/.cache` (not repo).
)
