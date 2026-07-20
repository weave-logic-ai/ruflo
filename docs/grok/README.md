# Ruflo on Grok Build

Host integration so Ruflo runs **at least as well as Claude Code**, with stronger multi-agent isolation.

| Artifact | Purpose |
|----------|---------|
| [`.grok/config.toml`](../../.grok/config.toml) | Project MCP (`ruflo`) + permissions |
| [`.grok/rules/ruflo-grok.md`](../../.grok/rules/ruflo-grok.md) | Host doctrine + tool map |
| [`.grok/agents/`](../../.grok/agents/) | Pipeline roles (architect/coder/tester/reviewer) |
| [`.grok/skills/agent-teams-grok/`](../../.grok/skills/agent-teams-grok/) | Named teams skill |
| [`.grok/skills/handoff/`](../../.grok/skills/handoff/) | Session handoff → **`docs/handoff.md`** |
| [`scripts/grok-team-bus.mjs`](../../scripts/grok-team-bus.mjs) | Host-agnostic mailbox (ADR-320) |
| [ADR-320](../../v3/docs/adr/ADR-320-grok-host-agnostic-agent-teams.md) | Architecture decision |

## Setup (once per machine)

1. **Trust the folder** in Grok (`/hooks-trust` or launch with `--trust`) — already required for project hooks.
2. **Restart Grok** (or reload MCPs) so `.grok/config.toml` is picked up.
3. Confirm:

```bash
grok mcp list
# expect: ruflo (project)
grok mcp doctor ruflo
```

4. Optional daemon:

```bash
npx -y ruflo@latest daemon start
npx -y ruflo@latest doctor
```

5. Optional **RuvNet Brain** grounding (not installed by default):

```bash
npx ruvnet-brain@latest
# then wire forge-mcp into .grok/config.toml (see commented block)
```

## Agent Teams (no Claude SendMessage)

```bash
node scripts/grok-team-bus.mjs create --name feature-x
node scripts/grok-team-bus.mjs plan --team feature-x \
  --steps '["architect","developer","tester","reviewer"]'
node scripts/grok-team-bus.mjs spawn --team feature-x --agent architect --role architect \
  --prompt "Design …" --next developer
# Use printed spawnPlan.host.grok → spawn_subagent (parallel, background)
```

See skill `agent-teams-grok`.

## Remotes (this fork)

| Remote | URL |
|--------|-----|
| `origin` | `git@github.com:weave-logic-ai/ruflo.git` |
| `upstream` | `git@github.com:ruvnet/ruflo.git` |

Feature work lands on `feat/grok-host` (or similar), not upstream `main` force-pushes.

## Status

- [x] Project MCP config + Grok rules
- [x] Host-agnostic team bus MVP (CLI)
- [x] Grok agents + skill
- [ ] MCP `team_*` tools inside Ruflo server
- [ ] RuvNet Brain MCP wired
- [ ] `init --grok` productization
- [ ] Conformance bench vs Claude host
)
