# Handoff — ruflo (Grok host) — 2026-07-20

Ruflo on **Grok Build** (weave-logic-ai fork). Branch `feat/grok-host`.  
**ADR-320 Phases 0–4 complete**, including host conformance bench.

## Current state

- Branch `feat/grok-host` → push only to **`origin`** (`git@github.com:weave-logic-ai/ruflo.git`), never `upstream`/ruvnet
- Local CLI MCP: **336 tools** (incl. 9 `team_*`) when pointed at built `bin/cli.js`
- Conformance: **`node scripts/bench-grok-host-conformance.mjs`** → **PASS** (92 pass / 0 critical fail / 1 soft warn)
- Report: `docs/benchmarks/grok-host-conformance-latest.{md,json}`
- Machine-local dirty: `.grok/config.toml` (abs paths for local CLI + Brain `KB_DIR`) — do not treat as portable

## Phase checklist (ADR-320)

| Phase | Scope | Status |
|-------|--------|--------|
| 0 | `.grok/` surface + MCP smoke | **Done** |
| 1 | team bus MVP | **Done** |
| 2 | spawn plans + agents + on_stop | **Done** |
| 3 | RuvNet Brain + `KB_DIR` | **Done** |
| 4 | `init --grok` + conformance bench | **Done** |

## Bench domains (all critical pass)

host-surface · inventory · teams · swarm · hive-mind · learning · neural · cli

Covers: team_* lifecycle, swarm_init/status/agent lifecycle, hive-mind init/spawn/memory/consensus/broadcast/shutdown, memory store/search + hooks pre/post-task/route/intelligence, neural status/train, CLI help + init --grok + doctor.

## Open (non-phase)

1. **Push** feature commits to weave-logic `origin` when ready
2. **Publish** npm packages if/when you control a release channel with `team_*`
3. Optional: live Claude Task side-by-side (bench is host-agnostic surface, not dual-host LLM run)

## Resume

```bash
cd /Users/mathewbeane/dev/ruflo
git checkout feat/grok-host
node scripts/bench-grok-host-conformance.mjs   # expect exit 0
grok mcp doctor ruflo                         # ~336 tools with local CLI
```

## Gotchas

- Push **only** to weave-logic origin
- Brain needs absolute `KB_DIR`
- team_* params: `team` / `agent`
- Bench uses local CLI `mcp exec` (no LLM $)
