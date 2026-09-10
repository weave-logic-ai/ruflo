# Ruflo on Grok Build

**Use Ruflo as the agent harness inside [Grok Build](https://x.ai/)**, with host-agnostic Agent Teams, swarms, hive-mind, memory, and the learning loop — without Claude Code’s proprietary `SendMessage` / `Task` APIs.

| Layer | Role |
|-------|------|
| **Grok** | Executor — edits files, runs shell/tests, `spawn_subagent`, synthesizes results |
| **Ruflo (MCP + CLI)** | Orchestrator / ledger — memory, swarm records, team bus, hooks, neural, security |

> After any `swarm_init`, `team_create`, or `agent_spawn`: **keep working**. Ruflo coordinates and records; it does **not** write your feature for you.

**Architecture decision:** [ADR-320 — Host-Agnostic Agent Teams](v3/docs/adr/ADR-320-grok-host-agnostic-agent-teams.md)

---

## Use Ruflo on a project *outside* this directory

**Yes — Ruflo is meant to run inside whatever app you’re building**, not only inside the ruflo monorepo. The monorepo is where you *develop* the harness; your other repo is where you *use* it.

All of the following commands are run from **your app’s root** (e.g. `~/dev/my-saas`), unless noted.

### Option 1 — Published npm (after ruv ships ADR-320 / Grok host)

```bash
cd /path/to/your-app          # ← any project, not the ruflo repo

npx -y ruflo@latest init --grok
# creates .grok/, scripts/grok-team-bus.mjs, docs/grok/ in *this* project

# Trust this folder in Grok, then restart Grok so project MCP loads.
grok mcp list
grok mcp doctor ruflo         # expect team_* once the published release has them
```

Open Grok **in `/path/to/your-app`** (or with that folder as the workspace). Project config lives at **`your-app/.grok/config.toml`** — not in the ruflo clone.

### Option 2 — Local monorepo CLI (pre-publish / bleeding edge)

Build Ruflo once, then point **any** project’s MCP at that binary:

```bash
# --- once: build the harness (inside the ruflo clone) ---
cd /path/to/ruflo             # this repo
git fetch upstream && git merge upstream/main   # stay current with ruvnet
cd v3 && pnpm install && pnpm --filter @claude-flow/cli... build
# binary: /path/to/ruflo/v3/@claude-flow/cli/bin/cli.js

# Make the shell `ruflo` command use this tree (npm global link):
./scripts/use-local-ruflo.sh
# which ruflo → …/dev/ruflo/ruflo/bin/ruflo.js

# --- for each external app ---
cd /path/to/your-app          # ← different directory

# Scaffold Grok files into *your-app* using the local CLI:
ruflo init --grok
# or:  node /path/to/ruflo/v3/@claude-flow/cli/bin/cli.js init --grok --force
```

Then edit **`/path/to/your-app/.grok/config.toml`** so Ruflo MCP uses the **built** CLI (absolute paths):

```toml
[mcp_servers.ruflo]
command = "node"
args = ["/path/to/ruflo/v3/@claude-flow/cli/bin/cli.js", "mcp", "start"]
enabled = true
startup_timeout_sec = 120
tool_timeout_sec = 180
```

Restart Grok with **your-app** as the workspace:

```bash
cd /path/to/your-app
grok mcp doctor ruflo         # ~336 tools incl. team_* while using local CLI
```

| Piece | Lives where |
|-------|-------------|
| Your code, `.grok/`, team bus scripts, handoff docs | **`your-app/`** |
| Ruflo CLI source + `dist` | **`ruflo/` monorepo** (or npm after publish) |
| Team/swarm/memory state (`.claude-flow/`, `.swarm/`) | **`your-app/`** (project-local) |

You do **not** need to open the ruflo monorepo in Grok to work on another product — only to rebuild the CLI when you change harness code.

---

## Two install paths (detail)

| Path | When to use | MCP entrypoint |
|------|-------------|----------------|
| **A. Published** (`npx ruflo@latest`) | After this work is merged upstream and **ruv publishes** a release that includes `init --grok` + `team_*` MCP tools | `npx -y ruflo@latest mcp start` |
| **B. Local monorepo** | Developing this fork / pre-publish / verifying latest `feat/grok-host` | `node <abs-path-to-ruflo>/v3/@claude-flow/cli/bin/cli.js mcp start` |

Today (pre-publish): published `ruflo@latest` may still ship **~327** tools **without** `team_*`. A local build exposes **~336** tools **including** 9 `team_*` tools. After a ruv release that includes ADR-320, Path A and Path B converge.

---

## Prerequisites

- **Node.js 20+** (22.x recommended)
- **Grok Build** CLI (`grok`) with **your app’s folder** trusted (hooks + project MCP)
- **pnpm** only if you build from monorepo source (Path B)
- Optional: [RuvNet Brain](https://isovision.ai/ruvnet-brain/) for source-grounded `search_ruvnet`

---

## Path A — Published package (post–upstream release)

Assumes a ruv npm release after an upstream PR lands (packages `ruflo` / `@claude-flow/cli` with Grok host + `team_*`).

### 1. Scaffold any project (not this monorepo)

```bash
cd /path/to/your-app          # e.g. ~/dev/my-saas — outside the ruflo clone
npx -y ruflo@latest init --grok
# Overwrite existing Grok files if needed:
# npx -y ruflo@latest init --grok --force
```

This writes:

| Path | Purpose |
|------|---------|
| `.grok/config.toml` | Project MCP (`ruflo`) + permissions |
| `.grok/rules/ruflo-grok.md` | Host doctrine + Claude→Grok tool map |
| `.grok/agents/` | architect / coder / tester / reviewer roles |
| `.grok/skills/` | `agent-teams-grok`, `handoff` |
| `scripts/grok-team-bus.mjs` | CLI fallback team bus |
| `docs/grok/README.md` | Short operator notes |

`init --grok` expands `{{HOME}}/` placeholders in Brain path comments so absolute paths are machine-ready when you uncomment them.

### 2. Trust the folder & restart Grok

1. Trust the project in Grok (required for project hooks / `.grok/`).
2. **Restart Grok** (or reload MCPs) so `.grok/config.toml` is applied.

Default MCP block (written by init):

```toml
[mcp_servers.ruflo]
command = "npx"
args = ["-y", "ruflo@latest", "mcp", "start"]
enabled = true
startup_timeout_sec = 120
tool_timeout_sec = 180
```

### 3. Verify

```bash
grok mcp list
grok mcp doctor ruflo
# Expect: handshake OK, ~336 tools once the published release includes team_*
# (older publishes: ~327 tools, no team_* — use Path B or wait for release)
```

Optional daemon / health:

```bash
npx -y ruflo@latest daemon start
npx -y ruflo@latest doctor
```

### 4. Use from the Grok session

1. Discover tools: `search_tool` with keywords like `team_`, `swarm_init`, `memory_search`, `hive-mind_`.
2. Call tools: `use_tool` with fully qualified names, e.g. `ruflo__team_create`, `ruflo__memory_search`.
3. Prefer a **small tool subset** (memory + team/swarm) over loading all 300+ tools into context.

---

## Path B — Local monorepo source (this repo / pre-publish)

Use this while developing on a fork (e.g. weave-logic-ai `feat/grok-host`) or before npm has `team_*`.  
**Target app can still be outside this directory** — see [Use Ruflo on a project outside this directory](#use-ruflo-on-a-project-outside-this-directory) Option 2.

### 1. Clone & build the CLI (once, in the ruflo clone)

```bash
git clone git@github.com:weave-logic-ai/ruflo.git   # or your fork
cd ruflo
git checkout feat/grok-host   # or the branch that carries Grok host work

cd v3
pnpm install
pnpm --filter @claude-flow/cli build
```

Entry point after build:

```text
/ABS/PATH/TO/ruflo/v3/@claude-flow/cli/bin/cli.js
```

### 2. Scaffold into an external project

`init --grok` writes files into **whatever directory is the current working directory**:

```bash
# Wrong if you only want harness files in my-app: don't leave cwd as the monorepo
# unless you intend to refresh monorepo .grok/

cd /path/to/your-app
node /ABS/PATH/TO/ruflo/v3/@claude-flow/cli/bin/cli.js init --grok
# --force overwrites existing .grok/ files in your-app
```

The monorepo already has its own `.grok/` for dogfooding; you usually **do not** re-init here when targeting another product.

### 3. Point that project’s Grok MCP at the local CLI

Edit **`/path/to/your-app/.grok/config.toml`** (absolute paths; do not rely on `~` alone):

```toml
[mcp_servers.ruflo]
command = "node"
args = ["/ABS/PATH/TO/ruflo/v3/@claude-flow/cli/bin/cli.js", "mcp", "start"]
enabled = true
startup_timeout_sec = 120
tool_timeout_sec = 180
```

Open Grok with **your-app** as the workspace, restart if needed, then:

```bash
cd /path/to/your-app
grok mcp doctor ruflo
# Expect ~336 tools including team_create, team_spawn, team_send, …
```

CLI smoke (from anywhere; state is still cwd-relative for team/swarm):

```bash
cd /path/to/your-app
node /ABS/PATH/TO/ruflo/v3/@claude-flow/cli/bin/cli.js mcp tools | head
node /ABS/PATH/TO/ruflo/v3/@claude-flow/cli/bin/cli.js mcp exec -t swarm_init -p '{"topology":"hierarchical","maxAgents":4}'
node /ABS/PATH/TO/ruflo/v3/@claude-flow/cli/bin/cli.js mcp exec -t team_create -p '{"name":"demo","host":"grok"}'
```

### 4. After upstream publish

When ruv ships a release that includes this work:

1. In **each consumer app**, switch `.grok/config.toml` to Path A (`npx -y ruflo@latest mcp start`), **or** keep pointing at a local build for bleeding-edge harness work.
2. Re-run `npx -y ruflo@latest init --grok` **inside each app** to refresh templates.
3. Confirm tool count / `team_*` with `grok mcp doctor ruflo` from that app.

---

## Optional: RuvNet Brain grounding

Installs a local knowledge base of rUv source so agents call `search_ruvnet` instead of inventing stack defaults.

```bash
npx ruvnet-brain@latest
# Bundle typically lands under: ~/.cache/ruvnet-brain/kb
```

Uncomment and set in `.grok/config.toml` (**`KB_DIR` is required** — without it, search fails looking for passages under the project cwd):

```toml
[mcp_servers.ruvnet-brain]
command = "node"
args = ["/ABS/HOME/.cache/ruvnet-brain/kb/forge-mcp-all.mjs"]
env = { KB_DIR = "/ABS/HOME/.cache/ruvnet-brain/kb" }
enabled = true
startup_timeout_sec = 90
tool_timeout_sec = 600   # first big-model search may download weights
```

If handshake fails on a missing `forge-hybrid.mjs`, copy it from the Brain marketplace/plugin kb into the cache `kb/` directory (see handoff notes).

---

## Core workflows

### Agent Teams (host-agnostic bus — ADR-320)

There is **no** Claude `SendMessage` on Grok. Use Ruflo:

```
team_create → team_plan → team_spawn → spawn_subagent(plan.host.grok)
           → team_send / team_inbox → team_on_stop → team_shutdown
```

**MCP parameter names:** `team` and `agent` (not `teamId` / `agentName`).

**Grok spawn defaults that beat shared-tree Claude teams:**

| Role | `capability_mode` | `isolation` |
|------|-------------------|-------------|
| architect / reviewer / researcher | `read-only` | `none` |
| developer / coder | `all` | **`worktree`** |
| tester | `all` / `execute` | **`worktree`** when writing tests |

Pipeline shape (lead is you):

```text
architect (design) → developer (implement) → tester → reviewer → lead synthesizes
```

Each agent’s prompt should say **who to message next** and **what artifact to hand off**.

**CLI fallback** (works even without MCP `team_*`):

```bash
node scripts/grok-team-bus.mjs create --name feature-x
node scripts/grok-team-bus.mjs plan --team feature-x \
  --steps '["architect","developer","tester","reviewer"]'
node scripts/grok-team-bus.mjs spawn --team feature-x --agent architect \
  --role architect --prompt "Design …" --next developer
# Use printed spawn plan → Grok spawn_subagent
```

Skill: `.grok/skills/agent-teams-grok/SKILL.md`

### Swarm

```bash
# MCP
# ruflo__swarm_init { topology: "hierarchical", maxAgents: 8, strategy: "specialized" }
# ruflo__agent_spawn { agentType: "coder" }
# ruflo__swarm_status / swarm_health / swarm_shutdown

# CLI
npx -y ruflo@latest swarm init --topology hierarchical --max-agents 8
# or local:
node v3/@claude-flow/cli/bin/cli.js swarm status
```

### Hive-mind (queen + consensus)

```bash
# MCP: hive-mind_init → hive-mind_spawn → hive-mind_memory / consensus / broadcast → hive-mind_shutdown
# CLI:
npx -y ruflo@latest hive-mind init -t hierarchical
npx -y ruflo@latest hive-mind status
```

### Learning loop (memory + hooks + neural)

| Step | Tool / command |
|------|----------------|
| Before work | `memory_search` (namespace `patterns`) |
| Route | `hooks_route` / `hooks_pre-task` |
| After success | `memory_store` + `hooks_post-task` (`success: true`) |
| Status | `hooks_intelligence`, `neural_status` |
| Train smoke | `neural_train` |

Always store durable patterns under namespace **`patterns`** after a successful approach.

### Session handoff

Skill `handoff` → canonical project path **`docs/handoff.md`** so another session can resume cleanly.

---

## Claude / CLAUDE.md → Grok tool map

| Claude / docs | Grok |
|---------------|------|
| `Task` / Agent Teams spawn | `spawn_subagent` (`background: true`) |
| `SendMessage` | `ruflo__team_send` / `team_inbox` (or CLI bus) |
| `TodoWrite` | `todo_write` |
| `Bash` | `run_terminal_command` |
| `Read` / `Grep` / `Glob` | `read_file` / `grep` / `list_dir` |
| `Write` / `Edit` | `write` / `search_replace` |
| `claude -p` | `spawn_subagent` or `grok -p` |
| `mcp__claude-flow__*` | `ruflo__*` via `search_tool` + `use_tool` |

Full doctrine: [`.grok/rules/ruflo-grok.md`](.grok/rules/ruflo-grok.md)

---

## Conformance bench (this monorepo)

Proves host surface + teams + swarm + hive-mind + learning + neural + CLI without spending LLM budget:

```bash
# From monorepo root, after Path B build
node scripts/bench-grok-host-conformance.mjs
# Reports:
#   docs/benchmarks/grok-host-conformance-latest.md
#   docs/benchmarks/grok-host-conformance-latest.json
```

Exit `0` = all critical checks passed. Soft warns (e.g. optional tool prefixes) are OK.

---

## Permissions (project `.grok/config.toml`)

Init templates allow Ruflo CLI + MCP without re-prompting every turn. Adjust as needed:

```toml
[permission]
allow = [
  "Bash(npx ruflo*)",
  "Bash(npx -y ruflo*)",
  "Bash(node scripts/grok-team-bus.mjs*)",
  "MCPTool(ruflo__*)",
  "MCPTool(ruvnet-brain__*)",
]
```

Deny still wins over allow; PreToolUse hooks can still block.

---

## Upstream contribution model

| Remote (this fork) | Purpose |
|--------------------|---------|
| `origin` → `weave-logic-ai/ruflo` | Daily push for Grok host work |
| `upstream` → `ruvnet/ruflo` | Open a **PR** for host-agnostic pieces only |

1. Land and verify on the fork (`feat/grok-host`, local MCP, conformance bench).
2. Open an upstream PR with **host-agnostic** changes (team bus, `init --grok`, templates, docs) — no force-push to upstream `main`.
3. After merge, **ruv publishes** `ruflo` / `@claude-flow/cli`.
4. Consumer projects use Path A (`npx ruflo@latest init --grok`).

Until that publish lands, Path B (local CLI) is the supported way to get `team_*` in Grok.

---

## Gotchas

| Symptom | Fix |
|---------|-----|
| MCP has ~327 tools, no `team_*` | Use Path B local CLI, or wait for published release with ADR-320 |
| Brain: `passages sidecar not found` | Set absolute `env.KB_DIR` to `…/ruvnet-brain/kb` |
| Brain cold start hangs | Raise `tool_timeout_sec` (e.g. 600); first BGE download is slow |
| Edited `.grok/config.toml` but tools unchanged | **Restart Grok** / reload MCPs |
| `team_*` “tool not found” / wrong args | Params are `team` + `agent`; ensure local/published build includes team tools |
| Waiting after `swarm start` for code | Ruflo does not execute — Grok/`spawn_subagent` does |
| Paths with only `~` in MCP config | Prefer **absolute** paths for `node` entrypoints |

---

## Quick reference

```bash
# ── External app (Path A, published) ──
cd /path/to/your-app
npx -y ruflo@latest init --grok
npx -y ruflo@latest doctor
grok mcp doctor ruflo

# ── External app (Path B, local CLI) ──
# once: cd /path/to/ruflo && ./scripts/use-local-ruflo.sh
cd /path/to/your-app
ruflo init --grok
# set .grok/config.toml args to monorepo bin/cli.js (or keep npx after publish)
grok mcp doctor ruflo

# ── Dogfood / develop the harness itself ──
cd /path/to/ruflo
git fetch upstream && git merge upstream/main
./scripts/use-local-ruflo.sh          # build + npm link → `ruflo` on PATH
ruflo --version && ruflo mcp tools | grep team_
node scripts/bench-grok-host-conformance.mjs
```

---

## Related docs

| Doc | Contents |
|-----|----------|
| [`.grok/rules/ruflo-grok.md`](.grok/rules/ruflo-grok.md) | In-session host doctrine |
| [`docs/grok/README.md`](docs/grok/README.md) | Short operator guide (init template) |
| [`docs/handoff.md`](docs/handoff.md) | Live session handoff for this fork |
| [`docs/benchmarks/grok-host-conformance-latest.md`](docs/benchmarks/grok-host-conformance-latest.md) | Latest bench report |
| [ADR-320](v3/docs/adr/ADR-320-grok-host-agnostic-agent-teams.md) | Design decision + phase status |
| Main [README.md](README.md) | Full Ruflo product overview |

---

**Remember:** Grok executes. Ruflo orchestrates. Agent Teams talk over the **Ruflo team bus**, not Claude `SendMessage`.
