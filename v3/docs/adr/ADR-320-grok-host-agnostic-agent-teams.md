# ADR-320: Host-Agnostic Agent Teams (Grok-first, Claude-portable)

**Status:** Accepted (Phases 0–4 complete on weave-logic-ai/ruflo `feat/grok-host`; see `docs/benchmarks/grok-host-conformance-latest.md`)  
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

## References

- [RuvNet Brain](https://isovision.ai/ruvnet-brain/) — grounding at intent + action; `search_ruvnet`
- `v3/plugins/teammate-plugin` — Claude-bound prior art
- `.claude/helpers/swarm-comms.sh` — mailbox seed
- `.grok/rules/ruflo-grok.md` — Grok host doctrine
- Grok user guide: MCP, hooks, subagents, skills, Claude compat
)
