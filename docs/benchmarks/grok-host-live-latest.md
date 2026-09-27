# Grok host live probe — probe-mukbtyzh

**When:** 2026-09-27T21:25:03.328Z
**Live model turn:** true
**Result:** PASS — 24 passed, 0 failed, 0 warnings

This probe starts the Grok binary. `bench-grok-host-conformance.mjs` does not.

| Status | Domain | Id | Detail |
|--------|--------|----|--------|
| PASS | discover | `inspect:version` | 1.0.41 |
| PASS | discover | `inspect:trusted` | folder trusted |
| PASS | discover | `inspect:rules` | /Users/mathewbeane/dev/ruflo/.grok/rules/ruflo-grok.md |
| PASS | discover | `inspect:agent:ruflo-architect` | /Users/mathewbeane/dev/ruflo/.grok/agents/ruflo-architect.md |
| PASS | discover | `inspect:agent:ruflo-coder` | /Users/mathewbeane/dev/ruflo/.grok/agents/ruflo-coder.md |
| PASS | discover | `inspect:agent:ruflo-tester` | /Users/mathewbeane/dev/ruflo/.grok/agents/ruflo-tester.md |
| PASS | discover | `inspect:agent:ruflo-reviewer` | /Users/mathewbeane/dev/ruflo/.grok/agents/ruflo-reviewer.md |
| PASS | discover | `inspect:skill:agent-teams-grok` | /Users/mathewbeane/dev/ruflo/.grok/skills/agent-teams-grok/SKILL.md |
| PASS | discover | `inspect:skill:handoff` | /Users/mathewbeane/dev/ruflo/.grok/skills/handoff/SKILL.md |
| PASS | discover | `inspect:hook:subagent-stop` | node "$CLAUDE_PROJECT_DIR/scripts/grok-subagent-stop-hook.mjs" |
| PASS | discover | `inspect:hook:user_prompt_submit` | claude compat hook loaded (not yet executed) |
| PASS | discover | `inspect:hook:pre_tool_use` | claude compat hook loaded (not yet executed) |
| PASS | discover | `inspect:hook:post_tool_use` | claude compat hook loaded (not yet executed) |
| PASS | discover | `inspect:hook:session_start` | claude compat hook loaded (not yet executed) |
| PASS | discover | `inspect:mcp:ruflo` | node via /Users/mathewbeane/.grok/config.toml |
| PASS | connect | `doctor:handshake` | node /Users/mathewbeane/dev/ruflo/v3/@claude-flow/cli/bin/cli.js mcp start; 362 tools discovered |
| PASS | connect | `server-tool:team_create` | on the server Grok starts |
| PASS | connect | `server-tool:memory_store` | on the server Grok starts |
| PASS | connect | `server-tool:memory_retrieve` | on the server Grok starts |
| PASS | connect | `server-tool:hooks_route` | on the server Grok starts |
| PASS | connect | `server-tool:swarm_init` | on the server Grok starts |
| PASS | connect | `server-tool:neural_status` | on the server Grok starts |
| PASS | execute | `hook:session-start` | SessionStart hook wrote a receipt |
| PASS | execute | `live:memory-roundtrip` | I'll look up the Ruflo memory tools, then store and retrieve the probe value.The store landed. I'll retrieve the same key again.PROBE_OK probe-ok |
