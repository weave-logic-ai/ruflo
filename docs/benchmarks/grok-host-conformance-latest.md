# Grok host conformance — bench-muk9plf6

**When:** 2026-09-27T20:25:26.310Z
**CLI:** `/Users/mathewbeane/dev/ruflo/v3/@claude-flow/cli/bin/cli.js`
**Result:** PASS — 92/93 checks (0 critical fails, 1 warns)

## Domains

| Domain | Pass | Fail | Warn |
|--------|-----:|-----:|-----:|
| host-surface | 15 | 0 | 0 |
| inventory | 26 | 0 | 1 |
| teams | 10 | 0 | 0 |
| swarm | 9 | 0 | 0 |
| hive-mind | 11 | 0 | 0 |
| learning | 10 | 0 | 0 |
| neural | 2 | 0 | 0 |
| cli | 9 | 0 | 0 |

## Capability grounding (RuvNet Brain)

- Multi-agent swarm orchestration
- Hive-mind / queen consensus
- Memory + AgentDB + embeddings
- Learning & reasoning pipelines (hooks/neural)
- Agent Teams host-agnostic bus (ADR-320)
- Grok host surface (init --grok)

## Failures / warns

- **WARN** `inventory` / `prefix-opt:security_`: absent (optional)

## All checks

| Status | Domain | Id | ms | Detail |
|--------|--------|----|---:|--------|
| PASS | host-surface | `file:.grok/config.toml` | 0 | present |
| PASS | host-surface | `file:.grok/rules/ruflo-grok.md` | 0 | present |
| PASS | host-surface | `file:.grok/agents/ruflo-architect.md` | 0 | present |
| PASS | host-surface | `file:.grok/agents/ruflo-coder.md` | 0 | present |
| PASS | host-surface | `file:.grok/agents/ruflo-tester.md` | 0 | present |
| PASS | host-surface | `file:.grok/agents/ruflo-reviewer.md` | 0 | present |
| PASS | host-surface | `file:.grok/skills/agent-teams-grok/SKILL.md` | 0 | present |
| PASS | host-surface | `file:.grok/skills/handoff/SKILL.md` | 0 | present |
| PASS | host-surface | `file:scripts/grok-team-bus.mjs` | 0 | present |
| PASS | host-surface | `file:v3/@claude-flow/cli/templates/grok/config.toml` | 0 | present |
| PASS | host-surface | `file:v3/@claude-flow/cli/src/mcp-tools/team-tools.ts` | 0 | present |
| PASS | host-surface | `file:v3/docs/adr/ADR-320-grok-host-agnostic-agent-teams.md` | 0 | present |
| PASS | host-surface | `config:ruflo-mcp` | 0 | mcp_servers.ruflo present |
| PASS | host-surface | `config:brain-docs` | 0 | Brain/KB_DIR documented |
| PASS | host-surface | `template:home-placeholder` | 0 | {{HOME}}/ placeholder present |
| PASS | inventory | `mcp-tools:list` | 129 | 340 tools listed |
| PASS | inventory | `prefix:team_` | 0 | present |
| PASS | inventory | `prefix:swarm_` | 0 | present |
| PASS | inventory | `prefix:hive-mind_` | 0 | present |
| PASS | inventory | `prefix:agent_` | 0 | present |
| PASS | inventory | `prefix:memory_` | 0 | present |
| PASS | inventory | `prefix:hooks_` | 0 | present |
| PASS | inventory | `prefix:neural_` | 0 | present |
| PASS | inventory | `prefix:embeddings_` | 0 | present |
| PASS | inventory | `prefix:task_` | 0 | present |
| PASS | inventory | `prefix:session_` | 0 | present |
| PASS | inventory | `prefix:config_` | 0 | present |
| PASS | inventory | `prefix:performance_` | 0 | present |
| WARN | inventory | `prefix-opt:security_` | 0 | absent (optional) |
| PASS | inventory | `prefix-opt:claims_` | 0 | present (optional) |
| PASS | inventory | `prefix-opt:guidance_` | 0 | present (optional) |
| PASS | inventory | `prefix-opt:browser_` | 0 | present (optional) |
| PASS | inventory | `capability:security` | 0 | security-related tools present |
| PASS | inventory | `team-tool:team_create` | 0 | registered |
| PASS | inventory | `team-tool:team_spawn` | 0 | registered |
| PASS | inventory | `team-tool:team_send` | 0 | registered |
| PASS | inventory | `team-tool:team_inbox` | 0 | registered |
| PASS | inventory | `team-tool:team_broadcast` | 0 | registered |
| PASS | inventory | `team-tool:team_plan` | 0 | registered |
| PASS | inventory | `team-tool:team_status` | 0 | registered |
| PASS | inventory | `team-tool:team_on_stop` | 0 | registered |
| PASS | inventory | `team-tool:team_shutdown` | 0 | registered |
| PASS | teams | `team_create` | 138 | ok |
| PASS | teams | `team_plan` | 139 | ok |
| PASS | teams | `team_spawn` | 143 | ok |
| PASS | teams | `team_send` | 138 | ok |
| PASS | teams | `team_status:pendingMail` | 144 | ok |
| PASS | teams | `team_spawn:developer` | 144 | ok |
| PASS | teams | `team_inbox` | 137 | ok |
| PASS | teams | `team_broadcast` | 144 | ok |
| PASS | teams | `team_on_stop` | 227 | ok |
| PASS | teams | `team_shutdown` | 187 | ok |
| PASS | swarm | `swarm_init` | 180 | ok |
| PASS | swarm | `swarm_status` | 165 | ok |
| PASS | swarm | `swarm_health` | 145 | ok |
| PASS | swarm | `agent_spawn` | 170 | ok |
| PASS | swarm | `agent_status` | 140 | ok |
| PASS | swarm | `agent_list` | 180 | ok |
| PASS | swarm | `agent_health` | 153 | ok |
| PASS | swarm | `agent_terminate` | 161 | ok |
| PASS | swarm | `swarm_shutdown` | 160 | ok |
| PASS | hive-mind | `hive-mind_init` | 144 | ok |
| PASS | hive-mind | `hive-mind_spawn` | 160 | ok |
| PASS | hive-mind | `hive-mind_memory:set` | 329 | ok |
| PASS | hive-mind | `hive-mind_memory:get` | 176 | ok |
| PASS | hive-mind | `hive-mind_consensus:propose` | 156 | ok |
| PASS | hive-mind | `hive-mind_consensus:vote` | 150 | ok |
| PASS | hive-mind | `hive-mind_consensus:status` | 144 | ok |
| PASS | hive-mind | `hive-mind_broadcast` | 142 | ok |
| PASS | hive-mind | `hive-mind_status` | 161 | ok |
| PASS | hive-mind | `hive-mind_optimize-memory` | 146 | ok |
| PASS | hive-mind | `hive-mind_shutdown` | 150 | ok |
| PASS | learning | `memory_store` | 317 | ok |
| PASS | learning | `memory_retrieve` | 314 | ok |
| PASS | learning | `memory_search` | 286 | hits=1 |
| PASS | learning | `memory_list` | 295 | ok |
| PASS | learning | `memory_stats` | 319 | ok |
| PASS | learning | `hooks_pre-task` | 294 | ok |
| PASS | learning | `hooks_route` | 612 | ok |
| PASS | learning | `hooks_post-task` | 369 | ok |
| PASS | learning | `hooks_intelligence` | 251 | ok |
| PASS | learning | `memory_delete` | 369 | ok |
| PASS | neural | `neural_status` | 713 | ok |
| PASS | neural | `neural_train` | 919 | ok |
| PASS | cli | `cli:swarm-help` | 156 | help ok |
| PASS | cli | `cli:hive-mind-help` | 148 | help ok |
| PASS | cli | `cli:neural-help` | 141 | help ok |
| PASS | cli | `cli:hooks-help` | 121 | help ok |
| PASS | cli | `cli:memory-help` | 137 | help ok |
| PASS | cli | `cli:init-grok-help` | 128 | help ok |
| PASS | cli | `cli:doctor` | 698 | exit=0 |
| PASS | cli | `cli:init-grok` | 161 | scaffold → /var/folders/1r/9rdx7_456zdc5t2rc1plvw7m0000gn/T/ruflo-grok-init-bench-muk9plf6 |
| PASS | cli | `cli:init-grok-home` | 0 | HOME paths materialized |
