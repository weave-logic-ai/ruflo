# ADR-402: Host-Agnostic Agent Teams (generic, Codex and Grok hosts)

**Status:** Accepted (Grok surface complete; Codex and command hosts added 2026-09-28)  
**Date:** 2026-07-20, revised 2026-09-28  
**Deciders:** weave-logic-ai / Ruflo Grok host effort  
**Related:** ADR-018 (Claude Code integration), teammate-plugin, swarm-comms mailbox, RuvNet Brain grounding, `init --codex`, `init --grok`  
**Checked against:** `grok 1.0.41`, `codex-cli 0.157.1`

---

## Context

Ruflo's multi-agent "Agent Teams" UX on Claude Code depends on host features: named agents with the proprietary `SendMessage` mailbox, the Claude `Task` tool / TeammateTool (`@claude-flow/teammate-plugin`, `~/.claude/teams/`), and the optional `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS`. The teammate-plugin is Claude-bound: it peer-depends on Claude Code and its spawn returns an `AgentInput` for Claude's `Task`.

Other agent runtimes have strong primitives of their own but no `SendMessage`:

| Capability | Grok Build | Codex CLI | Claude Agent Teams |
|------------|-----------|-----------|--------------------|
| Parallel children | `spawn_subagent` + background | `codex exec` processes; native `multi_agent` delegated by the model | Task / teammates |
| Isolation | `isolation: worktree` | `--sandbox read-only\|workspace-write`, `--worktree` | shared tree |
| Deterministic stop | SubagentStop hook | process exit + `--json` events | TeammateIdle / TaskCompleted |
| Stage continuity | `resume_from` | `codex exec resume <thread>` | message-only handoff |

Any other runtime with a one-shot CLI (`<bin> <flags> <prompt>`) could also be a teammate if Ruflo did not have to know its name. A prompt convention is not enough: teams need a durable bus, pipeline advancement, and results that survive a child that never calls a team tool.

The in-tree seed is `.claude/helpers/swarm-comms.sh`, a filesystem mailbox under `.claude-flow/swarm/mailbox/`.

## Decision

### 1. The bus lives in Ruflo

Comms are MCP tools plus on-disk state. Hosts only execute spawns and report stops.

| Tool | Purpose |
|------|---------|
| `team_create` | Create a team with a default host label, topology and max members |
| `team_spawn` | Register a teammate; return a spawn plan per host. Never executes anything |
| `team_send` / `team_broadcast` | Enqueue a message to an agent (or every member) |
| `team_inbox` | Drain or peek an agent's mailbox |
| `team_plan` | Ordered pipeline steps; the first becomes `ready` |
| `team_status` | Members, plan progress, pending mail |
| `team_on_stop` | Record a stop (`done` or `failed`), advance the plan on `done` |
| `team_shutdown` | Graceful teardown |

The same handlers are exposed without MCP as `ruflo team <create|spawn|send|inbox|broadcast|plan|status|on-stop|shutdown> --params '<json>'`, which prints the handler's JSON result and exits 1 when `success` is false. Scripts and hook shims use this interface.

### 2. Canonical on-disk format, single writer

`.claude-flow/teams/<team>/team.json` and `.claude-flow/swarm/mailbox/<agent>/<priority>_<id>.json` are a public format. The `team_*` handlers are its only writer.

- `team-tools.ts` exports `TeamState`, `TeamMember`, `PlanStep`, `TeamMessage` and `TEAM_SCHEMA_VERSION = 1`. Every write stamps `schemaVersion`.
- A missing `schemaVersion` is the legacy (v0) layout written by the original CLI bus. Reads normalize it: plan steps stored verbatim get `id`, `agent` and `status` by the `team_plan` rule, and a flat v0 Grok `spawn` entry is kept as data. Unknown keys are preserved.
- A `schemaVersion` newer than the reader knows is refused with an error, and nothing is written. An older tool cannot corrupt a newer layout.
- Read-modify-write handlers run under a short `O_EXCL` lock (`team.json.lock`, 2 s wait, a lock older than 10 s is stale) and write through a temp file plus rename, because parallel runners stop at the same time.
- Mailbox directories are keyed by agent, not by team. Two teams with the same agent name share an inbox; changing that would break existing mailboxes and is out of scope.

### 3. Host adapter seam

`team-tools.ts` does not build host plans inline. Each host implements one interface in `mcp-tools/team-hosts/`:

```ts
interface TeamHostAdapter {
  id: string;                                   // 'grok' | 'claude' | 'codex' | 'command'
  kind: 'native' | 'exec';
  protocolLines(ctx: SpawnContext): string[];   // host-specific lines in the child prompt
  plan(ctx: SpawnContext): Record<string, unknown>;  // becomes spawnPlan.host[<label>]
  stopIdentity(payload: unknown, env?: NodeJS.ProcessEnv): { team?: string; agent?: string; outcome?: 'done' | 'failed' };
}
```

`SpawnContext` carries the team, agent, role, role defaults (capability mode, isolation), next agents, task body, host label, optional model, and the resolved command-host config. The shared protocol (who you are, read `team_inbox` first, the next agents, how the handoff reaches them, the task) is built once; each adapter adds its own lines.

There are two kinds of host:

- A **native-spawn host** spawns children itself. The lead calls the host's spawn primitive with the plan's arguments, and the host's stop hook reports completion through `ruflo team hook-stop --host <id>`. Grok and Claude are native-spawn hosts.
- An **exec host** is a CLI that runs one headless turn and exits. `ruflo team run` executes it, and process exit is the stop signal. Codex and every command host are exec hosts.

`team_spawn` takes optional `hosts: string[]` and `model`. The default hosts are `[team.host, 'claude']`. Each `host.<label>` entry carries its own `prompt`; the top-level `prompt` is the variant for `team.host`. The registry resolves built-in labels first, then labels from `.claude-flow/team-hosts.json`. An unknown label is an error, never a silent fallback to Grok.

Spawn plan shape:

```json
{
  "teamId": "demo",
  "name": "reviewer",
  "role": "reviewer",
  "prompt": "…protocol + task for the team host…",
  "next": ["lead-check"],
  "host": {
    "codex":  { "kind": "exec", "exec": { "…": "…" }, "events": "codex-jsonl", "prompt": "…", "advisory": { "…": "…" } },
    "claude": { "taskType": "reviewer", "note": "optional back-compat path via Task tool", "prompt": "…" }
  }
}
```

### 4. Generic command host

Any agent runtime can be a teammate without Ruflo knowing its name. The project declares it in `.claude-flow/team-hosts.json`:

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

`team_create({ host: "myagent" })` or `team_spawn({ hosts: ["myagent"] })` then produces `host.myagent`. Validation is strict:

- the label and `command` match `^[A-Za-z0-9._/-]+$`; built-in labels cannot be redeclared;
- `kind` must be `exec`; unknown keys are rejected;
- `args` are strings; the placeholders are `{prompt}`, `{team}`, `{agent}`, `{role}`, `{cwd}`, `{teamRoot}` and `{resultFile}`, and each one must fill a whole argv element;
- `promptVia: "arg"` needs exactly one `{prompt}` element; `promptVia: "stdin"` must have none;
- `passEnv` holds environment variable names only.

The runner never uses a shell. Ruflo ships no runtime-specific host besides Grok, Claude and Codex.

### 5. Runner and stop signal for exec hosts

`ruflo team run --team T --agent A [--host <label>] [--timeout ms] [--max-output bytes] [--dry-run] [--json]` loads the member's stored exec plan (a v0 plan has none and is refused with "re-register with team_spawn"), fills placeholders in one pass, and runs the command with bounded output, a timeout, and stdin closed after the optional prompt. The child environment comes from `@claude-flow/codex`'s `buildWorkerEnvironment`: secret-named variables are stripped, the plan's `passEnv` names are re-added, and `CLAUDE_FLOW_CWD` is pinned to the team root. `--dry-run` prints the resolved argv and the names of passed env keys and starts nothing.

Exec children may have no Ruflo MCP (a runtime without an MCP client, or a sandbox that blocks it), so the runner does not rely on the child calling `team_inbox`. Before starting the host it drains the member's inbox (the same semantics as a `team_inbox` drain: messages are archived) and puts the messages in a delimited `=== Messages for you (N, …) ===` block just before the task in the prompt it hands the host. The run file lists the delivered message ids. When the run fails, the runner queues those messages again, so a retry sees them. `--dry-run` only peeks, so the messages stay queued. MCP stays optional, for sends and reads during the run.

When the process exits, the runner:

1. decides the outcome. For a plan with `events: "codex-jsonl"`, the outcome is `done` when the exit code is 0 and the last terminal event is not `turn.failed`; `turn.failed` (its error message becomes `reason`), a non-zero exit or a timeout is `failed`. An exit 0 with no terminal event is `done` with the warning `noTerminalEvent`. For a plain exec host, `done` means exit 0 and no timeout;
2. writes `.claude-flow/teams/T/runs/A-<runId>.json` with the exit code, duration, outcome, reason, result file, warnings, and for Codex the thread id and the MCP tools the child called;
3. sends the final message with `team_send` (`type: "result"`, capped at 64 KB, with a pointer to the run file) to each `next` agent, or to `lead` when there is none. A failed run goes to `lead` only, because the next step is not ready;
4. calls `team_on_stop` with `outcome`, `runId` and `reason`, then exits with the child's code (124 on timeout).

The bus therefore advances even when a sandboxed child never calls a `team_*` tool itself.

`team_on_stop` semantics:

- `failed` marks the member and the current step `failed`, does not advance, and returns a retry-or-reassign hint. A later `done` for the same agent advances normally.
- A repeated `runId` for the same member is a no-op, so a hook and the runner reporting the same stop are safe.
- `role:agent` labels (Grok's `description`) are normalized to `agent`.

`ruflo team hook-stop --host <id>` is the entry point for native stop hooks. It reads the hook JSON on stdin (300 ms cap), maps it through the adapter's `stopIdentity`, resolves the team from the payload, then `TEAM_NAME`, then the only active team, and calls `team_on_stop`. With several active teams and none named it does nothing rather than advance the wrong plan. It always exits 0.

The `team` command skips the CLI's update check, helper refresh and daemon autostart, because hooks and runners call it once per agent turn.

### 6. Codex host

Native Codex subagents (`multi_agent`) are delegated by the lead model's prompt, not by a deterministic call, so the primary Codex path is `codex exec` through the runner, and its stop signal is the `--json` event stream plus the exit code.

Plan (`host.codex`), built from the measured 0.157.1 flags only:

```json
{
  "contract": "codex-cli-0.157",
  "kind": "exec",
  "events": "codex-jsonl",
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

- Read-only roles get `--sandbox read-only`. Write roles get `--sandbox workspace-write`, plus `--worktree` when the role's isolation is `worktree`. `-m <model>` is added only when `team_spawn` gets a `model`.
- Plans never contain `--full-auto` (it does not exist in 0.157.1) or any `--dangerously-bypass-*` flag.
- The prompt goes over stdin (`-`) and stdin is then closed; `codex exec` otherwise waits for EOF.
- `{mcpServer}` resolves at run time to the first enabled `ruflo` or `claude-flow` in `codex mcp list --json`. If neither exists, the `-c` pair is dropped and the run records the warning `mcpServerNotFound`. The `"{teamRoot}"` form is filled with a JSON-quoted value, which is valid TOML for any path. Pinning `CLAUDE_FLOW_CWD` stops a child in a worktree from opening a second mailbox there.
- The thread id from `thread.started` is recorded on the member for a later `codex exec resume`.
- Parallelism is process-level: one `ruflo team run` per agent.

`init --codex` additions reuse `@claude-flow/codex`:

- **MCP:** unchanged; `registerMCPServer` already registers `ruflo` when missing.
- **AGENTS.md:** `renderTeamBusSection()` is included by the `default`, `full` and `enterprise` templates. It covers when to use `team_*`, the lead loop (`team_create` → `team_plan` → `team_spawn` → `ruflo team run` → `team_status`), and the child rules. `minimal` gets a short pointer to the skill.
- **Skill:** a packaged `agent-teams` skill, added to `BUILT_IN_SKILLS` and the `minimal` and `default` template defaults.
- **Hook (on by default):** `init --codex` idempotently merges one `SubagentStop` entry into the project's `.codex/hooks.json` that runs `npx --no-install ruflo team hook-stop --host codex` (`cmd /c …` on Windows). It uses the project's (or a global) installed ruflo and never downloads a package on a stop; with no CLI it prints why on stderr and still exits 0. Existing entries are kept and never reordered. init prints the `/hooks` trust step; Codex records its own trust when the user approves. The hook merge never writes `~/.codex/config.toml` or its trust ledger (the separate, pre-existing MCP registration step does add `[mcp_servers.ruflo]` there when it is missing). `--no-team-hooks` skips the merge. The hook covers native Codex subagents; `ruflo team run` does not depend on it. Codex `SubagentStop` field names are not verified yet, so the Codex adapter's `stopIdentity` accepts the Claude-shaped names plus `agent_type`, `agent_id` and `name`.

The dual-mode orchestrator's process and environment code is shared through two exported functions in `@claude-flow/codex/dual-mode` (`runHeadlessProcess`, `buildWorkerEnvironment`), added in `@claude-flow/codex` 3.0.4. The runner does not use the orchestrator itself, which coordinates through AgentDB memory rather than the team bus.

### 7. Grok host

Checked against `grok 1.0.41` and its user guide:

- `spawn_subagent` accepts `prompt`, `description`, `background`, `isolation`, and optionally `cwd`, `resume_from` and `model`. It does not accept `subagent_type` or `capability_mode`; an omitted type is `general-purpose`.
- Nesting depth is 1. Only the lead calls `spawn_subagent`.
- `.grok/agents/*.md` are session profiles (`--agent-profile`, `/agents`), not spawn types.
- Project `.grok/config.toml` contributes `[mcp_servers]`, `[plugins]`, `[permission]` and `[mcp].max_output_bytes`; `[subagents]` there is ignored. MCP tools are reached through `search_tool` / `use_tool` (`ruflo__team_create`). Folder trust gates project MCP, hooks, skills and rules together.

`host.grok` is the only Grok plan shape:

```json
{
  "contract": "grok-build-1.0.41",
  "spawn": { "description": "architect:architect", "background": true, "isolation": "none" },
  "advisory": { "capability_mode": "read-only", "subagent_type": "plan", "note": "…" },
  "prompt": "…"
}
```

The lead passes `spawn` plus `prompt` to `spawn_subagent` and leaves `advisory` on the plan. The prompt carries the read-only or worktree constraint; `isolation: "worktree"` is the enforced knob for write roles. Plans carry no project-specific agent-type names.

The Grok SubagentStop hook (`scripts/grok-subagent-stop-hook.mjs`) strips the `role:` prefix from the spawn description and does nothing when several teams are active and none is named. The shipped `templates/grok/scripts/grok-team-bus.mjs` is a shim: it keeps its original flags, maps each verb to `ruflo team <verb> --params`, and has no file I/O of its own. It resolves the CLI as `RUFLO_CLI` → the project's `node_modules` → `ruflo` on PATH → `npx --no-install ruflo`, never downloads a package, and exits 2 with a clear message when no CLI is found or the one found predates `ruflo team`. `npx ruflo init --grok` writes `.grok/config.toml`, rules, agents, skills and these scripts.

### 8. Claude host

`host.claude` stays a back-compat entry (`taskType` for the `Task` tool). Its `stopIdentity` reads the Claude-shaped hook fields. The teammate-plugin remains for native TeammateTool users.

### 9. Grounding

RuvNet Brain (`search_ruvnet`) grounding with intent and action policy is part of the same host effort, so a model does not drift to training-prior infrastructure.

## Verification

- **Format:** a checked-in v0 fixture is read by `team_status`, advanced by `team_on_stop`, and rewritten with `schemaVersion: 1` without losing fields; `schemaVersion: 2` is refused without a write; `team run` refuses the v0 member. The Grok shim, run through the built CLI, leaves the same `team.json` as the handlers for the same call sequence.
- **Unit:** plan shape per adapter (Grok unchanged; Codex sandbox, worktree, stdin and model; command validation and rejections); `stopIdentity` per adapter; `team_on_stop` failed, duplicate and `role:agent` cases; ten concurrent stops under the lock; the runner with a fake command host (result file, handoff, plan advance, failure, timeout, dry run, queued messages delivered in the prompt and archived) and a fake `codex` on PATH (`turn.completed`, `turn.failed`, no terminal event); the hook merge (empty project, existing events, idempotent, opt-out).
- **Bench:** `scripts/bench-host-conformance.mjs --host grok|codex|command|all`, with `bench-grok-host-conformance.mjs` as the Grok alias. Domains: host surface, tool inventory, teams, swarm, hive-mind, learning loop, neural and CLI parity for Grok; host plan and Codex init (AGENTS.md section, skill, default hook merge, trust step, opt-out) for Codex; host plan and the runner against a fake host for command hosts. Reports go to `docs/benchmarks/host-conformance-<host>-latest.{md,json}` (the alias keeps `grok-host-conformance-latest`). No model calls; child CLIs run with `RUFLO_DAEMON_AUTOSTART=0`.
- **Live probe:** `scripts/probe-host-live.mjs` starts a model turn only with `--execute` (one headless turn per host) or `--live` (grok/claude: a memory round trip; codex/command: a one-step team through `ruflo team run`, asserting the run file, the lead's result message and the plan index). Codex `--execute` is `codex exec --ephemeral --sandbox read-only --skip-git-repo-check --json -`, passing on `turn.completed`. `--host command --command-label <label> --project <dir>` runs the round trip with a project's own host entry.

## Consequences

### Positive

- The same team semantics on Grok, Codex, Claude and any command host.
- Exec hosts advance the pipeline without host hooks or hook trust.
- Worktree isolation and sandboxes reduce multi-agent file conflicts compared with shared-tree teams.
- One writer and a versioned format let external tools interoperate through `ruflo team <verb>`.

### Negative / costs

- The `team_*` tools, adapters and the runner must be maintained against moving host CLIs (flags are pinned in each plan's `contract`).
- The Codex hook needs a one-time `/hooks` trust step; until then only the runner path reports stops.
- Runner children do not yet get a minted capability envelope and invocation token the way dual-mode workers do. The environment builder is shared; the policy preflight is a follow-up.

### Neutral

- teammate-plugin remains for native Claude TeammateTool users.
- CLAUDE.md examples stay valid on Claude; `.grok/rules/ruflo-grok.md` takes precedence on Grok; AGENTS.md carries the Codex rules.

## Alternatives considered

| Alternative | Why rejected |
|-------------|--------------|
| Prompt-only "pretend SendMessage" | No durable bus, no pipeline advancement |
| Wait for hosts to add SendMessage | Speculative; the bus should not be proprietary |
| Codex native subagents as the primary path | Delegation is prompt-triggered, not deterministic, and needs hook trust |
| One named adapter per runtime in Ruflo | Does not scale; the command host covers any one-shot CLI |
| Separate writers (CLI bus and MCP tools) | Different locking and status rules would corrupt each other |

## References

- [RuvNet Brain](https://isovision.ai/ruvnet-brain/) — grounding at intent + action; `search_ruvnet`
- `v3/plugins/teammate-plugin` — Claude-bound prior art
- `.claude/helpers/swarm-comms.sh` — mailbox seed
- `.grok/rules/ruflo-grok.md` — Grok host doctrine
- Grok user guide (subagents, hooks, MCP); `codex exec --help` (0.157.1)
