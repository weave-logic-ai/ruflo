# Handoff — ruflo (Grok host) — 2026-07-20

Ruflo is the rUv agent meta-harness (MCP + CLI + hooks + swarms + AgentDB). This checkout is a **weave-logic-ai fork** being adapted so the harness runs **in Grok Build**, with agent teams and skills treated as critical—not a thin Codex-style CLI wrapper. Foundation for the Grok host is on branch `feat/grok-host`, **uncommitted**, MCP and memory verified, team bus MVP working via filesystem CLI.

## Current state

- Branch `feat/grok-host` @ `12ede21767a6dd669df1b79392a5d27d9154f237` (same tip as `upstream/main` / PR #2725 merge), **dirty — untracked only** (no commits yet on this branch beyond shared main tip)
- Remotes:
  - `origin` → `git@github.com:weave-logic-ai/ruflo.git`
  - `upstream` → `git@github.com:ruvnet/ruflo.git`
- Toolchain: Node **v22.23.1**, `grok` at `~/.grok/bin/grok`, published **`ruflo v3.32.8`** via `npx -y ruflo@latest`
- Local monorepo CLI **`v3/@claude-flow/cli/dist` is missing** — do not point MCP at local bin until built; always use published package for MCP/CLI
- Ruflo MCP registered **project-scoped** in `.grok/config.toml`; `grok mcp list` shows `ruflo` (project)
- Memory DB initialized at `.swarm/memory.db` (hybrid + HNSW); pattern `grok-host-smoke` stored
- Folder is **trusted** in `~/.grok/trusted_folders.toml` (hooks can run)
- RuvNet Brain **not installed** (`~/.cache/ruvnet-brain` absent); package on npm is `ruvnet-brain@3.4.21-dev`
- No full monorepo tsc/lint/container build run this session (host-integration only)
- Smoke team `smoke-demo` may still exist under `.claude-flow/teams/` (gitignored) — leftover from bus smoke, status `shutdown`

### Untracked (ready to commit when asked)

```
.grok/                          # config, rules, agents, skills, hooks
docs/grok/README.md
docs/handoff.md                 # this file
scripts/grok-team-bus.mjs
scripts/grok-subagent-stop-hook.mjs
v3/docs/adr/ADR-320-grok-host-agnostic-agent-teams.md
```

## What's working (verified)

| Thing | State | Verified how |
|---|---|---|
| Git remotes weave-logic-ai + ruvnet | works | `git remote -v`; `git fetch origin` / `upstream` succeeded; tips matched `12ede2176` |
| Project `.grok/config.toml` TOML | works | `python3 tomllib` parse OK after fix |
| Grok MCP `ruflo` | works | `grok mcp list` → project; `grok mcp doctor ruflo` → handshake OK, **327 tools** |
| Ruflo CLI (npx) | works | `npx -y ruflo@latest --version` → `ruflo v3.32.8` |
| AgentDB memory init + store/search | works | `memory init` verification 6/6; store `patterns/grok-host-smoke`; search "grok host" score **0.77** in **9ms** |
| Team bus CLI MVP | works | create/plan/spawn/send/inbox/on-stop/status/shutdown on team `smoke-demo` |
| Grok project rules/skills/agents | on disk | `.grok/rules/ruflo-grok.md`, agents, `agent-teams-grok` + `handoff` skills |
| Handoff path convention | locked | **always `docs/handoff.md`**; skill vendored at `.grok/skills/handoff/` |

## Done this session

- Plan: Grok can run Ruflo; target is **better than Claude Code** (agent teams + skills + Brain grounding + worktree isolation), not Codex-only MVP
- Remotes rewired for fork development on weave-logic-ai
- Project Grok host surface: MCP config, doctrine rules, 4 role agents, agent-teams skill, SubagentStop hook adapter
- **Host-agnostic team bus** (`scripts/grok-team-bus.mjs`) per ADR-320 — filesystem mailboxes under `.claude-flow/`, spawn plans for Grok `spawn_subagent` (no Claude `SendMessage`)
- ADR-320 written: put Agent Teams bus in Ruflo, not in host
- Memory initialized; smoke pattern stored for resume
- Handoff skill project-vendored; canonical path **`docs/handoff.md`**

## Measurements & calibration

| Metric | Value | Notes |
|---|---|---|
| Ruflo MCP tools discovered | **327** | `grok mcp doctor ruflo` |
| MCP handshake | OK, protocol 2024-11-05 | cold npx; keep `startup_timeout_sec = 120` |
| Memory search latency | **9ms** (later) / 3ms (earlier) | query "grok host" / "grok host agent teams" |
| Semantic hit on smoke key | **0.77** / **0.71** | `patterns/grok-host-smoke` |
| AgentDB controller init | Activated **16**, Failed **7**, Init **~31857ms** | from `memory init` output |
| Published package | **ruflo v3.32.8** | matches main tip release |
| npx cache failure (once) | `ENOTEMPTY` rename on agentdb | fixed by removing broken `_npx/2ed56890c96f58f7` cache dir |

## Dead ends — do not retry

- **Pointing MCP/CLI at monorepo `v3/@claude-flow/cli/bin/cli.js` without build** — `ERR_MODULE_NOT_FOUND` for `dist/src/index.js`. Use `npx -y ruflo@latest` until `dist/` exists.
- **Empty / broken TOML tables in `.grok/config.toml`** — a stray `)` after `[subagents]` and empty `[subagents.models]` caused `TOML parse error`; Grok then reported **no MCP servers**. Always re-run `grok mcp list` after editing project config.
- **Expecting Claude `SendMessage` / TeammateTool on Grok** — teammate-plugin is Claude-bound (`~/.claude/teams/`, Task AgentInput). Use team bus + `spawn_subagent` instead.
- **Relying on UserPromptSubmit hook stdout for routing/Brain injection** — Grok passive hooks largely ignore stdout; use system rules + MCP tools + file/CLI fallbacks (see `.grok/rules/ruflo-grok.md`).
- **Codex-only "executor + ledger records" as the end state** — user rejected as insufficient; agent teams, skills, and Brain grounding are **P0**.
- **Assuming `~/.claude/skills/handoff` alone is enough for the fork** — user-level Claude skill is discoverable via compat, but project skill was vendored so weave-logic-ai does not depend on one machine's `~/.claude`.

## Open threads

1. **Commit + push `feat/grok-host` to origin (weave-logic-ai)** — not done; user must approve commit. Done = PR branch with host surface + ADR + scripts.
2. **Install and wire RuvNet Brain** — `npx ruvnet-brain@latest`, then enable commented MCP block in `.grok/config.toml` (or add forge-mcp path). Done = `search_ruvnet` callable from Grok; embeddings answers cite RuVector not Pinecone.
3. **Native MCP `team_*` tools** — CLI bus is interim; promote create/send/inbox/spawn-plan into Ruflo MCP server. Done = `search_tool` finds `team_create` etc. without shelling out.
4. **`init --grok` productization** — mirror `init --codex`. Done = one command writes `.grok/*` for any repo.
5. **Restart Grok session** so this interactive session fully loads project MCP/rules/skills (doctor worked from CLI; in-session tools may need reload).
6. **Optional:** clear leftover `.claude-flow/teams/smoke-demo`; remove `.LOCKED` helper auto-refresh marker if helper refresh is needed.
7. **Upstream merge discipline** — keep `team_*` host-agnostic so it can PR to ruvnet later; do not force-push upstream.

## Resume here

```bash
cd /Users/mathewbeane/dev/ruflo
git checkout feat/grok-host
git status -sb
git remote -v   # origin=weave-logic-ai, upstream=ruvnet

# Confirm host surface
grok mcp list
grok mcp doctor ruflo
npx -y ruflo@latest --version
npx -y ruflo@latest memory search --query "grok host"

# Team bus smoke (optional)
node scripts/grok-team-bus.mjs create --name resume-demo --topology hierarchical
node scripts/grok-team-bus.mjs spawn --team resume-demo --agent architect --role architect \
  --prompt "Sanity check handoff resume" --next developer

# Next product work (pick one)
# A) commit + push feat/grok-host when user asks
# B) npx ruvnet-brain@latest && wire MCP in .grok/config.toml
# C) implement team_* MCP tools in CLI package (requires local build of dist/)
```

## Key paths

- `docs/handoff.md` — **this file** (canonical handoff; rewrite only)
- `.grok/config.toml` — project MCP + permissions (`startup_timeout_sec = 120`)
- `.grok/rules/ruflo-grok.md` — Grok host doctrine / tool map
- `.grok/agents/ruflo-*.md` — architect / coder / tester / reviewer
- `.grok/skills/agent-teams-grok/` — multi-agent pipeline skill
- `.grok/skills/handoff/` — project handoff skill (prefers this path)
- `scripts/grok-team-bus.mjs` — host-agnostic Agent Teams bus (ADR-320 MVP)
- `scripts/grok-subagent-stop-hook.mjs` — SubagentStop → `on-stop`
- `v3/docs/adr/ADR-320-grok-host-agnostic-agent-teams.md` — architecture decision
- `docs/grok/README.md` — operator guide for Grok host
- `.swarm/memory.db` — AgentDB (initialized this session)
- Plan (session): `~/.grok/sessions/.../plan.md` — long-form feasibility plan (not committed)

## Gotchas

- **Restart Grok after editing `.grok/config.toml`** or MCP will look “missing.”
- **Never use unbuilt local CLI for MCP** until `v3/@claude-flow/cli/dist/src/index.js` exists.
- **`.claude-flow/` is gitignored** — team/mailbox state is local only; document team names in handoff if needed.
- **Claude Agent Teams language in root `Claude.md`** still describes `SendMessage` / `Task`; on Grok, `.grok/rules/ruflo-grok.md` wins for host behavior.
- **Helper `.LOCKED` marker** skips helper auto-refresh — noisy WARN only unless you need helper updates.
- **User rule: do not commit to master/main** without explicit exception; this work is on `feat/grok-host`.
- **Don't commit unless asked** for this handoff file either — write only.
)
