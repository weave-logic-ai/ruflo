# Handoff — ruflo (Grok host) — 2026-07-20 (continue)

Ruflo is the rUv agent meta-harness (MCP + CLI + hooks + swarms + AgentDB). This checkout is a **weave-logic-ai fork** adapted so the harness runs **in Grok Build**, with agent teams and skills treated as critical. Branch `feat/grok-host`.

## Current state

- Branch `feat/grok-host` (product commits through `a50f31cb3` + **uncommitted continue session work**)
  - Host surface: `89a7eaa1e`
  - team_* MCP + init --grok + Brain wiring: `8f8771236`
  - Prior handoff snapshot: `a50f31cb3`
- Remotes: `origin` → weave-logic-ai/ruflo; `upstream` → ruvnet/ruflo
- Toolchain: Node **v22.23.1**, `grok` at `~/.grok/bin/grok`, published **`ruflo v3.32.8`**
- **In-session MCP (verified this session):** ruflo **336 tools** (9 `team_*`), Brain **1 tool**, tasks present
- Project `.grok/config.toml` → **local** CLI (`node …/bin/cli.js`) + Brain **`KB_DIR`** (machine abs paths; **do not treat as portable**)
- Memory patterns: `grok-host-smoke`, `pattern-grok-host-team-mcp-init`, `pattern-grok-host-local-mcp-wire`, `pattern-grok-host-continue-pendingmail-init-home`

## What's working (verified this session)

| Thing | State | Verified how |
|---|---|---|
| In-session team_* | **works** | create→spawn→send→inbox→status→on_stop→shutdown on `session-continue-smoke` |
| Local MCP tool count | **336** | system MCP registry + prior doctor |
| team-tools vitest | **2/2** | after pendingMail fix |
| init --grok `{{HOME}}/` expand | **works** | temp dir: Brain args/env get abs home; prose comment keeps `{{HOME}}` |
| `.ruvnet-brain/` gitignore | added | meter ledger no longer untracked once committed |

## Done this continue session

- Live MCP smoke of all primary `team_*` tools (params: **`team`** / **`agent`**)
- **`team_status` pendingMail** includes mailbox dirs for agents not yet registered (pre-spawn handoffs)
- **gitignore** `.ruvnet-brain/`
- Template + docs: Brain `KB_DIR`, local CLI override, team MCP preference
- **`init --grok` materializeGrokConfig**: expands `{{HOME}}/` (and quoted `$HOME/`) only
- Rebuild CLI + vitest green

## Open threads

1. **Commit continue session product delta** (gitignore, team-tools, init, templates, docs) — leave machine-abs project `.grok/config.toml` out of portable commits or commit only on this fork with a note.
2. **Publish** `@claude-flow/cli` / `ruflo` so `npx ruflo@latest` includes `team_*` + `init --grok` polish.
3. **Conformance bench vs Claude host** — not started.
4. **Upstream PR** to ruvnet — host-agnostic only; no force-push upstream.
5. Optional: full-corpus Brain MCP (default ~62 repos; slower than `KB_REPOS=agentdb` smoke).

## Resume here

```bash
cd /Users/mathewbeane/dev/ruflo
git checkout feat/grok-host
git status -sb

grok mcp doctor ruflo          # expect ~336 tools with local CLI
# team_* via MCP (in-session) or:
node scripts/grok-team-bus.mjs create --name smokeN

# Rebuild after team/init edits
cd v3
pnpm --filter @claude-flow/cli build
pnpm --filter @claude-flow/cli exec vitest run __tests__/team-tools.test.ts
```

## Key paths

- `docs/handoff.md` — this file
- `.grok/config.toml` — **local** MCP (abs paths) — machine-specific
- `v3/@claude-flow/cli/src/mcp-tools/team-tools.ts` — ADR-320
- `v3/@claude-flow/cli/src/init/grok-generator.ts` — `init --grok` + HOME materialize
- `v3/@claude-flow/cli/templates/grok/` — scaffold templates
- `v3/docs/adr/ADR-320-grok-host-agnostic-agent-teams.md`

## Gotchas

- **team_* args** are `team` / `agent` (not teamId / agentName).
- **Brain without `KB_DIR`** → passages sidecar not found under project cwd.
- **Published npx** still ~327 tools until release with team_*.
- **Do not commit to main**; work on `feat/grok-host`.
- **Don't commit** secrets or Brain meter under `.ruvnet-brain/` (now gitignored).
