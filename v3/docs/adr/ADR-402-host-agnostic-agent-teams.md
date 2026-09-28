# ADR-402: Host-Agnostic Agent Teams (Grok-first, Claude-portable)

**Status:** Accepted (Phases 0–4 complete; see `docs/benchmarks/grok-host-conformance-latest.md`)  
**Date:** 2026-07-20  
**Deciders:** weave-logic-ai / Ruflo Grok host effort  
**Related:** ADR-018 (Claude Code integration), teammate-plugin, swarm-comms mailbox, RuvNet Brain grounding, `init --codex` pattern

---

## Context

Ruflo’s multi-agent “Agent Teams” UX on Claude Code depends on host features:

- Named agents + proprietary **`SendMessage`** mailbox
- Claude `Task` tool / TeammateTool (`@claude-flow/teammate-plugin`, `~/.claude/teams/`)
- Optional `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`

Grok Build already provides strong primitives that Claude Agent Teams lack or only partially have:

| Capability | Grok | Claude Agent Teams |
|------------|------|--------------------|
| Parallel children | `spawn_subagent` + background | Task / teammates |
| Isolation | **`isolation: worktree`** | Shared tree (race-prone) |
| Least privilege | `capability_mode` | Soft / prompt-level |
| Stage continuity | `resume_from` | Message-only handoff |
| Hooks | Claude-compat + SubagentStop | TeammateIdle / TaskCompleted |
| Skills | `.agents` + `.claude` discovery | Claude skills |

Today’s **teammate-plugin is Claude-bound** (peerDep on Claude Code, spawn returns `AgentInput` for Claude Task). A Grok-only prompt convention is not enough: teams, skills, and learning are product-critical and must work **better than Claude Code**.

Existing seed in-tree: `.claude/helpers/swarm-comms.sh` already implements a **filesystem mailbox** under `.claude-flow/swarm/mailbox/`.

## Decision

1. **Put the Agent Teams bus in Ruflo, not in the host.**  
   Comms are MCP + on-disk/AgentDB state. Hosts only execute spawns and run hooks.

2. **Ship `team_*` MCP tools** (host-agnostic contract):

   | Tool | Purpose |
   |------|---------|
   | `team_create` | Create team + topology + max members |
   | `team_spawn` | Register teammate; return **spawn plan** for the host |
   | `team_send` | Enqueue message to named agent (or `*`) |
   | `team_inbox` | Drain / peek mailbox for agent |
   | `team_broadcast` | Fan-out |
   | `team_plan` | Steps + dependencies (pipeline) |
   | `team_status` | Members, queues, plan progress |
   | `team_on_stop` | Idle-assign / train (hook entry) |
   | `team_shutdown` | Graceful teardown |

3. **Spawn plan contract** (host adapter):

```json
{
  "teamId": "team_…",
  "name": "architect",
  "role": "architect",
  "prompt": "…comms protocol embedded…",
  "host": {
    "grok": {
      "subagent_type": "general-purpose",
      "capability_mode": "read-only",
      "isolation": "none",
      "background": true
    },
    "claude": {
      "taskType": "system-architect",
      "note": "optional back-compat path"
    }
  },
  "next": ["developer"]
}
```

Grok lead calls `spawn_subagent` with the plan; it does **not** need `SendMessage`.

4. **Storage**

   - Team state: project-local `.claude-flow/teams/{teamId}/` (not `~/.claude/teams/`)
   - Mailbox: reuse/extend `.claude-flow/swarm/mailbox/{agent}/` (+ optional AgentDB namespace `team:{id}`)
   - Learning: existing `post-task` / memory_store patterns

5. **Grok defaults that beat Claude**

   - Write agents: `isolation: worktree`
   - Research/review: `read-only` / explore
   - Pipeline: short cycles + `team_on_stop` idle assign
   - Optional `resume_from` for stage continuity when mailbox payload is large

6. **Grounding (RuvNet Brain)** is in scope for the same host effort:  
   `search_ruvnet` (or forge-mcp) + intent/action policy so the model does not drift to training-prior infra.

7. **Product entry:** `npx ruflo init --grok` (later) mirrors `init --codex` — writes `.grok/config.toml`, rules, agents, MCP registration.

## Consequences

### Positive

- Same team semantics on Grok, Codex, Claude (Claude becomes one adapter).
- Worktree isolation reduces multi-agent file conflicts vs Claude shared-tree teams.
- Federation can later ride the same bus.
- Upstreamable: host-agnostic core can be proposed back to ruvnet/ruflo.

### Negative / costs

- Must implement and maintain `team_*` tools and adapters.
- Grok may not inject `UserPromptSubmit` stdout the way Claude injects `additionalContext` — route/brain hooks need file or MCP fallbacks.
- Skill/tool surface must be curated to avoid context drowning (300+ MCP tools + 100+ skills).

### Neutral

- teammate-plugin remains for native Claude TeammateTool users until migrated to the agnostic bus.
- CLAUDE.md Claude-specific examples stay valid for Claude hosts; Grok overlay (`.grok/rules/ruflo-grok.md`) takes precedence on Grok.

## Implementation plan (summary)

1. Phase 0: project `.grok/config.toml` + rules + MCP smoke — **done**.
2. Phase 1: mailbox-backed `team_create/send/inbox/status` MVP — **done** (CLI + MCP).
3. Phase 2: `team_spawn` spawn plans + Grok agent defs + SubagentStop → `team_on_stop` — **done**.
4. Phase 3: RuvNet Brain MCP + grounding rules — **done** (`KB_DIR` required).
5. Phase 4: `init --grok` + host conformance bench — **done**.
   - Bench: `node scripts/bench-grok-host-conformance.mjs`
   - Domains: host surface, tool inventory, teams, swarm, hive-mind, learning loop, neural, CLI parity
   - Report: `docs/benchmarks/grok-host-conformance-latest.{md,json}`
   - Note: not a live Claude Task/SendMessage side-by-side; proves the **host-agnostic MCP/CLI surface** Grok uses is complete (same tools Claude would call via Ruflo).

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| Prompt-only “pretend SendMessage” | No durable bus, no idle assign, not better than Claude |
| Depend on Grok adding SendMessage | Speculative; bus should not be proprietary |
| Codex-style “single executor + swarm records only” | Fails requirement: agent teams + skills are critical |
| Fork forever without agnostic bus | Blocks upstream and multi-host |

## Amendment (2026-09-27) — Grok Build 1.0.41

Re-checked against `grok 1.0.41` and `~/.grok/docs/user-guide/` on that binary. The spawn example in the Decision section above matches Grok as of 2026-07-20. The live tool no longer matches it.

- `spawn_subagent` accepts `prompt`, `description`, `background`, `isolation`, and optionally `cwd`, `resume_from`, and `model`. It does not accept `subagent_type` or `capability_mode`. An omitted type is `general-purpose`. Capability is a property of the agent definition, which spawn cannot select.
- Nesting depth is 1. Only the lead calls `spawn_subagent`.
- Project `.grok/config.toml` contributes `[mcp_servers]`, `[plugins]`, `[permission]`, and `[mcp].max_output_bytes`. `[subagents]` in that file is ignored.
- `.grok/agents/*.md` are session profiles (`--agent-profile`, `/agents`).
- MCP tools are still reached through `search_tool` / `use_tool` (`ruflo__team_create`). `grok mcp add` still defaults to user scope; `--scope project` / `-s project` writes `./.grok/config.toml`.
- Folder trust (`/hooks-trust`, `grok --trust`) gates project MCP, hooks, skills, and rules together.

`team_spawn` now returns `host.grok.spawn` (the arguments to pass) and `host.grok.advisory` (role constraint, not a spawn argument). The prompt states the read-only or worktree constraint. `isolation: "worktree"` remains the enforced isolation knob. Operator steps and the re-check list live in `docs/grok/README.md`.

## Amendment (2026-09-28) — Codex and custom command hosts

Checked against `codex-cli 0.157.1` and `grok 1.0.41`. This amendment adds a Codex adapter at parity with Grok, a generic command host for any agent runtime that has a one-shot CLI, and one adapter seam so hosts are not copy-pasted branches.

### Two kinds of host

A **native-spawn host** spawns children itself. The lead calls the host's own spawn primitive with the plan's arguments, and the host's stop hook reports completion. Grok (`spawn_subagent`) and Claude (`Task`) are native-spawn hosts.

An **exec host** is a CLI that runs one headless turn and exits. Ruflo runs it through `ruflo team run`, and the process exit is the stop signal. No hook, and no hook trust, is needed on that path. `codex exec` is an exec host. Any runtime with a command like `<bin> <flags> <prompt>` can be one through the command adapter.

Codex is both. Native Codex subagents (`multi_agent`) are delegated by the lead model's prompt, not by a deterministic call, so the **Codex stop signal is the runner's, and only the runner's, by default**: `ruflo team run` parses the `codex exec --json` event stream and the process exit (see Runner). Nothing is written to Codex's hook config or trust ledger by default. A `SubagentStop` hook for native Codex subagents is opt-in (`init --codex --team-hooks`). Codex records its own trust when the user approves it in `/hooks`, and Ruflo never writes that ledger.

### Host adapter seam

`team-tools.ts` stops building host plans inline. Each host implements one interface in `mcp-tools/team-hosts/`:

```ts
interface TeamHostAdapter {
  id: string;                              // 'grok' | 'claude' | 'codex' | 'command'
  kind: 'native' | 'exec';
  protocolLines(ctx: SpawnContext): string[];   // host-specific lines in the child prompt
  plan(ctx: SpawnContext): Record<string, unknown>;  // becomes spawnPlan.host[<label>]
  stopIdentity(payload: unknown): { team?: string; agent?: string; outcome?: 'done' | 'failed' };
}
```

`SpawnContext` carries the team, agent, role, role defaults (capability, isolation), next agents, the task body, and the resolved host config. The shared protocol text (bus rules, inbox, next agents, task) is built once. Each adapter adds its own lines.

- `team_spawn` takes an optional `hosts: string[]`. The default is `[team.host, 'claude']`, so existing Grok teams get the same `host.grok` and `host.claude` entries as before. Each host entry now carries its own `prompt`. The top-level `prompt` is the variant for `team.host`, which keeps back-compat.
- The Grok adapter output is unchanged. The existing Grok unit test is the regression guard.

### Codex plan (`host.codex`)

```json
{
  "contract": "codex-cli-0.157",
  "kind": "exec",
  "exec": {
    "command": "codex",
    "args": ["exec", "--sandbox", "read-only", "--skip-git-repo-check", "--json",
             "-o", "{resultFile}", "-C", "{cwd}",
             "-c", "mcp_servers.{mcpServer}.env.CLAUDE_FLOW_CWD=\"{teamRoot}\"", "-"],
    "promptVia": "stdin",
    "closeStdin": true,
    "passEnv": ["CODEX_HOME", "OPENAI_API_KEY", "OPENAI_BASE_URL"]
  },
  "advisory": { "capability_mode": "read-only", "isolation": "none", "note": "…" }
}
```

- Sandbox: read-only roles get `--sandbox read-only`. Write roles get `--sandbox workspace-write`, plus `--worktree` when the role's isolation is `worktree`. Plans never contain `--dangerously-bypass-approvals-and-sandbox`.
- The prompt goes over stdin (`-`) and stdin is then closed. `codex exec` blocks until stdin reaches EOF when it is left open (the same issue the dual-mode orchestrator already works around).
- `CLAUDE_FLOW_CWD` is pinned for the child's Ruflo MCP server. Without it, a child in a worktree would open a second mailbox inside the worktree.
- `{mcpServer}` resolves at run time to whichever of `ruflo` or `claude-flow` `codex mcp list --json` shows.
- `passEnv` is the adapter's allowlist of auth variables. Everything else goes through the orchestrator's existing secret-stripping environment builder.

### Command host (`host.<label>`, generic)

Any agent runtime can be a teammate without Ruflo knowing its name. Its project declares it in `.claude-flow/team-hosts.json`:

```json
{ "hosts": { "myagent": {
    "kind": "exec",
    "command": "myagent",
    "args": ["run", "--message", "{prompt}"],
    "promptVia": "arg",
    "passEnv": ["MYAGENT_API_KEY"],
    "isolation": "none"
} } }
```

`team_create --host myagent` or `team_spawn --hosts ["myagent"]` then produces `host.myagent` from the command adapter. Validation: the label and command must match `^[A-Za-z0-9._/-]+$`, and `args` must be strings. The allowed placeholders are `{prompt}`, `{team}`, `{agent}`, `{role}`, `{cwd}`, `{teamRoot}` and `{resultFile}`, and each one must fill a whole argv element. With `promptVia: "arg"`, exactly one element is `{prompt}`. The runner never uses a shell. `team_spawn` only returns data and never executes anything. Ruflo ships no runtime-specific host besides Grok, Claude and Codex.

### Runner and stop signal

`ruflo team run --team T --agent A [--host <label>] [--timeout ms] [--dry-run]` loads the member's stored plan and runs `exec` with bounded output and a timeout. When the process exits, the runner:

0. decides the outcome. For a host whose plan sets `events: "codex-jsonl"`, the outcome is `done` when the last terminal event is `turn.completed` and the exit code is 0. It is `failed` on `turn.failed` (its `error` becomes `reason`), on a non-zero exit, or on a timeout. An exit 0 with no terminal event is `done` with the warning `noTerminalEvent`. For a plain exec host, the outcome is `done` if and only if the exit code is 0 and there was no timeout;
1. writes `.claude-flow/teams/T/runs/A-<runId>.json` with the exit code, duration, the result file (or captured stdout), and the Codex thread id from `--json` when present;
2. sends the final message with `team_send` (`type: "result"`) to each `next` agent, or to `lead` when there is none. A failed run goes to `lead` only, because the next step is not ready;
3. calls `team_on_stop` with the `outcome` from step 0, `runId`, and `reason`.

This is how the bus advances even when the child never calls a `team_*` tool itself. `--dry-run` prints the resolved argv and the names of passed env keys, then exits without starting the host.

`ruflo team <create|spawn|send|inbox|broadcast|plan|status|on-stop|shutdown> --params '<json>'` calls the same handlers as the MCP tools, in-process, and prints their JSON result. It is the public, non-MCP interface for scripts and for hook shims.

`ruflo team hook-stop --host <id>` is the entry point for native hooks. It reads the hook JSON from stdin, maps it through `adapter.stopIdentity`, calls `team_on_stop`, and always exits 0.

### `team_on_stop` changes

- It accepts optional `outcome` (`done` | `failed`), `runId` and `reason`. `failed` marks the step `failed`, does not advance the plan, and returns a retry-or-reassign hint.
- A repeated `runId` for the same agent is a no-op. That makes a hook and the runner reporting the same stop safe.
- `role:agent` labels (Grok's `description`) are normalized to `agent`. Before this change, the Grok hook's fallback to `description` produced an invalid name and the stop was dropped.
- Writes to `team.json` go to a temp file and are renamed into place, under a short `O_EXCL` lock file, because parallel runners now stop concurrently.

### `init --codex` additions

These reuse `@claude-flow/codex` and do not add a second generator:

- **MCP:** the existing `registerMCPServer` already registers `ruflo` when it is missing. There is no change.
- **AGENTS.md:** a new `renderTeamBusSection()` in `generators/agents-md.ts` covers when to use `team_*`, the lead loop (`team_create` → `team_plan` → `team_spawn` → `ruflo team run` → `team_status`), and the rule that a child reads `team_inbox` first and ends by replying with its handoff.
- **Skill:** a packaged `agent-teams` skill under the codex package's `.agents/skills/`. It is added to `BUILT_IN_SKILLS` and to the `default` and `minimal` template defaults.
- **Hook (opt-in, `--team-hooks`):** idempotently merge one `SubagentStop` entry into project `.codex/hooks.json` that calls `ruflo team hook-stop --host codex`. Existing entries are kept. init prints the `/hooks` trust step and never writes `~/.codex/config.toml`. Without the flag, init writes no hook, and exec teams work fully.

### Canonical on-disk format and a single writer

`.claude-flow/teams/<team>/team.json` and `.claude-flow/swarm/mailbox/<agent>/<priority>_<id>.json` are a public format. The `team_*` handlers in `team-tools.ts` are its only writer.

- `team-tools.ts` exports the types `TeamState`, `TeamMember`, `PlanStep` and `TeamMessage`, and the constant `TEAM_SCHEMA_VERSION = 1`. `team.json` gains `schemaVersion`. A missing `schemaVersion` means the legacy (v0) layout the original CLI bus wrote, which is readable as is.
- Reads normalize v0 data. A plan step object missing `id`, `agent` or `status` is filled from its index, the same rule `team_plan` applies. A member `spawn` without a `host` key (the flat v0 Grok plan) is kept but has no `exec` entry, so `team run` refuses it with "re-register with team_spawn". The first write stamps `schemaVersion: 1`.
- A reader that sees a `schemaVersion` higher than it knows returns an error and does not write. An older tool therefore cannot corrupt a newer layout.
- The shipped `templates/grok/scripts/grok-team-bus.mjs` becomes a shim. It maps its existing flags to `ruflo team <verb> --params`, resolving the `ruflo` binary the same way the `ruflo-core` hook shim does, and it keeps its CLI surface. It no longer writes files itself.

### Verification

- **Format:** a checked-in v0 fixture (a team.json and mailbox as written by the original CLI bus) is read by `team_status`, advanced by `team_on_stop`, and rewritten with `schemaVersion: 1` without losing fields. `schemaVersion: 2` is refused. The Grok shim produces byte-identical `team.json` key sets to the MCP handlers for the same sequence of calls.
- **Unit:** plan shape per adapter (Grok unchanged; Codex sandbox, worktree and stdin; command placeholder validation and rejections); `stopIdentity` for each adapter; `team_on_stop` failed and duplicate cases and `role:agent` normalization; the runner with a fake exec host (a node one-liner) covering the result file, the handoff message and the plan advance; the lock under concurrent stops.
- **Bench:** `bench-grok-host-conformance.mjs` becomes a host bench driven by `--host grok|codex|command|all`. The existing script name stays as an alias. New domains are host plan contract, runner (fake host), and the Codex init product (AGENTS.md section, skill, hooks merge on a temp dir). No model calls.
- **Live probe:** `probe-host-live.mjs` makes model turns opt-in. `--execute` runs one headless turn, and `--live` adds the team round-trip. Without either flag, no host process that calls a model is started. The Codex adapter's `execute` step is implemented with `codex exec --ephemeral`, and needs no hook trust. `--live --host codex` runs a two-step team (a read-only child and a lead check) and asserts the plan advanced through the runner. The outcome comes from `--json` events, not from a hook.

### Out of scope

- Mailbox directories are keyed by agent, not by team, so two teams with the same agent name share an inbox. That is recorded here and not changed. Changing it would break existing on-disk mailboxes.
- Minting a capability envelope and token for runner children the way the dual-mode orchestrator does is a follow-up. The runner reuses the orchestrator's environment builder but not its policy preflight.

## References

- [RuvNet Brain](https://isovision.ai/ruvnet-brain/) — grounding at intent + action; `search_ruvnet`
- `v3/plugins/teammate-plugin` — Claude-bound prior art
- `.claude/helpers/swarm-comms.sh` — mailbox seed
- `.grok/rules/ruflo-grok.md` — Grok host doctrine
- Grok user guide: MCP, hooks, subagents, skills, Claude compat
)
