# Host probe — probe-mukzgeo0

**When:** 2026-09-28T08:26:00.333Z
**Hosts:** grok, claude, codex
**Live model turn:** false
**Result:** PASS — 31 passed, 0 failed, 1 warnings, 6 skipped

Skips are surfaces that host does not expose. They are not passes.

| Status | Host | Domain | Id | Detail |
|--------|------|--------|----|--------|
| PASS | grok | discover | `binary` | /Users/mathewbeane/.grok/bin/grok |
| PASS | grok | discover | `inspect:version` | 1.0.41 |
| PASS | grok | discover | `inspect:trusted` | folder trusted |
| PASS | grok | discover | `inspect:rules` | /Users/mathewbeane/dev/ruflo/.grok/rules/ruflo-grok.md |
| PASS | grok | discover | `inspect:agent:ruflo-architect` | /Users/mathewbeane/dev/ruflo/.grok/agents/ruflo-architect.md |
| PASS | grok | discover | `inspect:agent:ruflo-coder` | /Users/mathewbeane/dev/ruflo/.grok/agents/ruflo-coder.md |
| PASS | grok | discover | `inspect:agent:ruflo-tester` | /Users/mathewbeane/dev/ruflo/.grok/agents/ruflo-tester.md |
| PASS | grok | discover | `inspect:agent:ruflo-reviewer` | /Users/mathewbeane/dev/ruflo/.grok/agents/ruflo-reviewer.md |
| PASS | grok | discover | `inspect:skill:agent-teams-grok` | /Users/mathewbeane/dev/ruflo/.grok/skills/agent-teams-grok/SKILL.md |
| PASS | grok | discover | `inspect:skill:handoff` | /Users/mathewbeane/dev/ruflo/.grok/skills/handoff/SKILL.md |
| PASS | grok | discover | `inspect:hook:subagent-stop` | node "$CLAUDE_PROJECT_DIR/scripts/grok-subagent-stop-hook.mjs" |
| PASS | grok | discover | `inspect:mcp` | ruflo via /Users/mathewbeane/.grok/config.toml |
| WARN | grok | discover | `inspect:mcp:extra` | also loaded: claude-flow via /Users/mathewbeane/.claude.json |
| PASS | grok | connect | `doctor:handshake` | node /Users/mathewbeane/dev/ruflo/v3/@claude-flow/cli/bin/cli.js mcp start; 362 tools discovered |
| PASS | grok | connect | `server-tool:team_create` | exposed by the configured server command |
| PASS | grok | connect | `server-tool:memory_store` | exposed by the configured server command |
| PASS | grok | connect | `server-tool:memory_retrieve` | exposed by the configured server command |
| PASS | grok | connect | `server-tool:hooks_route` | exposed by the configured server command |
| PASS | grok | connect | `server-tool:swarm_init` | exposed by the configured server command |
| PASS | grok | connect | `server-tool:neural_status` | exposed by the configured server command |
| PASS | grok | status | `statusline` | RuFlo loaded │ ruflo │ rules │ 4 agents │ 2 skills │ hook │ trusted |
| PASS | grok | status | `statusline:wired` | user ~/.grok/config.toml has [ui.status_line] (project config cannot set this) |
| PASS | claude | discover | `binary` | /Users/mathewbeane/.local/bin/claude |
| SKIP | claude | discover | `inspect` | Claude Code has no inspect --json. File presence is not evidence a session loaded rules, agents, skills, or hooks. |
| PASS | claude | connect | `mcp:claude-flow` | claude-flow: Scope: User config (available in all your projects) Status: ✔ Connected Type: stdio Command: npx Args: -y ruflo@latest mcp start Environment: CLAUDE_FLOW_MCP_TOOLS=memory,swarm,agent,hooks To remove this server, run: claude mcp |
| SKIP | claude | connect | `server-tools` | claude mcp get does not report the tool list or the spawned command reliably enough to assert tool names |
| PASS | claude | status | `statusline` | RuFlo loaded │ claude statusLine |
| PASS | codex | discover | `binary` | /Users/mathewbeane/.local/bin/codex |
| SKIP | codex | discover | `inspect` | Codex CLI has no inspect --json for rules, agents, skills, or hooks. |
| PASS | codex | connect | `mcp:configured` | claude-flow: node /Users/mathewbeane/dev/ruflo/v3/@claude-flow/cli/bin/cli.js |
| SKIP | codex | connect | `mcp:handshake` | codex mcp list shows configuration, not a live handshake |
| PASS | codex | connect | `server-tool:team_create` | present on the configured CLI |
| PASS | codex | connect | `server-tool:memory_store` | present on the configured CLI |
| PASS | codex | connect | `server-tool:memory_retrieve` | present on the configured CLI |
| PASS | codex | connect | `server-tool:hooks_route` | present on the configured CLI |
| PASS | codex | connect | `server-tool:swarm_init` | present on the configured CLI |
| SKIP | codex | connect | `server-tool:neural_status` | host filter CLAUDE_FLOW_MCP_TOOLS=memory,swarm,agent,hooks,team does not include neural |
| SKIP | codex | status | `statusline` | RuFlo │ codex mcp configured (no status row) — this host has no status row |
